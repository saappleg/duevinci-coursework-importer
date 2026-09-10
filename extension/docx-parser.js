(() => {
  const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const WEEK_NUMBERS = {
    ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7,
    EIGHT: 8, NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12,
  };

  function clean(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function textFromNode(node) {
    return clean([...node.getElementsByTagNameNS(WORD_NS, 't')].map((part) => part.textContent || '').join(''));
  }

  function bytesToString(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function readU16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function findEndOfCentralDirectory(bytes) {
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 0xffff - 22); offset -= 1) {
      if (readU32(bytes, offset) === 0x06054b50) return offset;
    }
    throw new Error('The selected file is not a readable DOCX file.');
  }

  async function readDocxEntry(file, wantedName) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const eocd = findEndOfCentralDirectory(bytes);
    const entryCount = readU16(bytes, eocd + 10);
    const centralOffset = readU32(bytes, eocd + 16);
    let cursor = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      if (readU32(bytes, cursor) !== 0x02014b50) throw new Error('The DOCX archive index is invalid.');
      const method = readU16(bytes, cursor + 10);
      const compressedSize = readU32(bytes, cursor + 20);
      const nameLength = readU16(bytes, cursor + 28);
      const extraLength = readU16(bytes, cursor + 30);
      const commentLength = readU16(bytes, cursor + 32);
      const localHeaderOffset = readU32(bytes, cursor + 42);
      const name = bytesToString(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      if (name === wantedName) {
        if (readU32(bytes, localHeaderOffset) !== 0x04034b50) throw new Error('The DOCX entry header is invalid.');
        const localNameLength = readU16(bytes, localHeaderOffset + 26);
        const localExtraLength = readU16(bytes, localHeaderOffset + 28);
        const start = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressed = bytes.slice(start, start + compressedSize);
        if (method === 0) return bytesToString(compressed);
        if (method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('This DOCX uses an unsupported compression format.');
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return bytesToString(new Uint8Array(await new Response(stream).arrayBuffer()));
      }
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error('The DOCX does not contain its main document content.');
  }

  function itemKind(title) {
    const value = title.toLowerCase();
    if (/\bquiz\b|\bexam\b|\btest\b/.test(value)) return 'quiz';
    if (/\bproject\b|\blab\b/.test(value)) return 'project';
    if (/\btask\b|\bsubmit\b|\bassessment\b/.test(value)) return 'assignment';
    if (/\blesson\b|\bsection\b|\bread\b/.test(value)) return 'module';
    return 'coursework';
  }

  function idFor(value) {
    // Hash the complete source key. Truncating the encoded prefix makes every
    // item in the same week collide because they share the same course/week
    // prefix, which causes Supabase's upsert to reject the whole batch.
    let hash = 1469598103934665603n;
    for (const byte of new TextEncoder().encode(value)) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 1099511628211n);
    }
    return `school-wgu-${hash.toString(16).padStart(16, '0')}`;
  }

  function targetDate(scan, week, maxWeek) {
    const start = scan.courseStartAt ? Date.parse(scan.courseStartAt) : Number.NaN;
    if (Number.isNaN(start)) return null;
    const end = scan.courseEndAt ? Date.parse(scan.courseEndAt) : Number.NaN;
    if (!Number.isNaN(end) && end > start && maxWeek > 0) return new Date(start + ((end - start) * week / maxWeek));
    return new Date(start + (week * 7 * 24 * 60 * 60 * 1000));
  }

  function parsePacingGuideXml(xml, scan, fileName = '') {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error('The pacing guide document could not be read.');
    const tables = [...document.getElementsByTagNameNS(WORD_NS, 'tbl')];
    if (!tables.length) throw new Error('No week-by-week table was found in this pacing guide.');
    const rows = [...tables[0].getElementsByTagNameNS(WORD_NS, 'tr')];
    let currentWeek = 0;
    const parsedRows = [];
    for (const row of rows) {
      const cells = [...row.getElementsByTagNameNS(WORD_NS, 'tc')].map((cell) => [...cell.getElementsByTagNameNS(WORD_NS, 'p')].map(textFromNode).filter(Boolean));
      const weekText = clean(cells[0]?.join(' ')).toUpperCase();
      if (WEEK_NUMBERS[weekText]) currentWeek = WEEK_NUMBERS[weekText];
      if (!currentWeek) continue;
      const todos = cells[1] || [];
      const recommendations = cells[2] || [];
      parsedRows.push({ week: currentWeek, todos, recommendations });
    }
    const maxWeek = Math.max(0, ...parsedRows.map((row) => row.week));
    const items = [];
    const seen = new Set();
    const addItem = (rawTitle, week, source) => {
      let title = clean(rawTitle)
        .replace(/\s*\(Note:\s*The Evaluation Team[^)]*\)\s*/i, '')
        .replace(/\s*\(Note:[^)]*\)\s*/i, '')
        .replace(/:$/, '')
        .trim();
      if (!title || title.length < 3 || title.length > 180) return;
      if (/^before you proceed to week\b/i.test(title) || /^you did it\b/i.test(title)) return;
      const key = title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const due = targetDate(scan, week, maxWeek);
      items.push({
        id: idFor(`${scan.courseSourceId}|pacing-guide|week-${week}|${key}`),
        title: `Week ${week} · ${title}`,
        dueAt: due?.toISOString() || null,
        dueText: due ? `Week ${week} pacing target` : `Week ${week} pacing target (date not available)`,
        dueIsEstimated: true,
        kind: itemKind(title),
        sourceUrl: scan.pacingGuideUrl ? `${scan.pacingGuideUrl}#week-${week}` : fileName || scan.url,
        selected: true,
        week,
        source,
      });
    };

    for (const row of parsedRows) {
      for (const title of row.todos) addItem(title, row.week, 'to-do');
      for (const recommendation of row.recommendations) {
        // Recommendations contain explanatory guidance mixed with a few real milestones.
        // Keep only those milestones; avoid importing directions such as “scroll down”.
        if (/^(complete\b|begin\s+working\s+on\s+task\b|enroll\s+in\s+the\s+live\s+cohort\b|enroll\s+in\s+the\s+live\s+cohorts\b)/i.test(recommendation)) {
          addItem(recommendation, row.week, 'recommendation');
        }
      }
    }
    return { ...scan, items, pacingGuideFileName: fileName, requiresPacingGuide: false, pacingGuideImported: true };
  }

  async function parsePacingGuide(file, scan) {
    if (!file?.name?.toLowerCase().endsWith('.docx')) throw new Error('Choose the downloaded WGU pacing guide DOCX file.');
    const xml = await readDocxEntry(file, 'word/document.xml');
    return parsePacingGuideXml(xml, scan, file.name);
  }

  globalThis.DueVinciDocx = { parsePacingGuide, parsePacingGuideXml };
})();
