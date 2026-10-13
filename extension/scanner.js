(() => {
  if (globalThis.__dueVinciScannerInstalled) return;
  globalThis.__dueVinciScannerInstalled = true;

  const MAX_ITEMS = 75;
  const MAX_MAESTRO_ITEMS = 300;
  const PLATFORM_SELECTORS = {
    canvas: ['[data-testid="assignment-row"]', '#assignments .assignment', '.context_module_item', '.ig-row'],
    moodle: ['.activity-item', '.courseindex-item', '.assign', '.quiz'],
    blackboard: ['#content_listContainer > li', '.contentListPlain > li', '.ulist li'],
    brightspace: ['d2l-labs-course-content-item', '.d2l-tile', '.d2l-link'],
    maestro: ['main [data-testid*="lesson"]', 'main [data-testid*="module"]', 'main [data-testid*="task"]', 'main [class*="lesson"]', 'main [class*="module"]', 'main [class*="task"]', 'a[href*="/learn/"]'],
    generic: ['article', '[role="listitem"]', '.assignment', '.activity', '.task', '.item'],
  };
  const SUPPORTED_PLATFORMS = new Set(['auto', 'wgu', 'maestro', 'canvas', 'moodle', 'blackboard', 'brightspace', 'generic']);
  const DATE_RANGE_PATTERN = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})\s*[-–—−‑]\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/;

  function clean(value) { return (value || '').replace(/\s+/g, ' ').trim(); }

  function stableItemId(prefix, value) {
    let hash = 1469598103934665603n;
    for (const byte of new TextEncoder().encode(String(value))) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 1099511628211n);
    }
    return `${prefix}-${hash.toString(16).padStart(16, '0')}`;
  }

  function parseDateValue(value) {
    const numeric = clean(value).match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/);
    if (numeric) {
      const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
      const month = Number(numeric[1]);
      const day = Number(numeric[2]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date.toISOString().slice(0, 10);
      return null;
    }
    const timestamp = Date.parse(value || '');
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  function platformForPage(sourceOverride = 'auto') {
    if (SUPPORTED_PLATFORMS.has(sourceOverride) && sourceOverride !== 'auto') return sourceOverride;
    const host = location.hostname.toLowerCase();
    const body = document.body?.className?.toString().toLowerCase() || '';
    if (host === 'my.wgu.edu' || host.endsWith('.my.wgu.edu')) return 'wgu';
    if (host === 'app.maestro.org' || host.endsWith('.maestro.org')) return 'maestro';
    if (host.includes('instructure.com') || body.includes('context_modules') || document.querySelector('#assignments')) return 'canvas';
    if (host === 'learn.snhu.edu' || host.includes('brightspace.com') || host.includes('desire2learn') || location.pathname.startsWith('/d2l/') || document.querySelector('d2l-navigation-main-header')) return 'brightspace';
    if (host.includes('blackboard') || document.querySelector('#content_listContainer')) return 'blackboard';
    if (host.includes('moodle') || document.querySelector('.activity-item, .courseindex-item')) return 'moodle';
    return 'generic';
  }

  function dueDetails(text) {
    const match = clean(text).match(/(?:due|deadline|submit(?:\s+by)?|available\s+until)\s*[:\-]?\s*([^|·;]{3,72})/i);
    if (!match) return { dueAt: null, dueText: '' };
    const dueText = clean(match[1]).replace(/(?:\s+(?:points?|grade|status)\b.*)$/i, '');
    const timestamp = Date.parse(dueText);
    return { dueAt: Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString(), dueText };
  }

  function candidateTitle(node) {
    const preferred = node.querySelector('h1, h2, h3, h4, h5, [data-testid*="title"], .item_name, .title, .name, a[href*="assignments"], a[href*="module"], a[href*="activity"]');
    const title = clean(preferred?.textContent || '');
    if (title && title.length >= 3 && title.length <= 180) return title;
    const text = clean(node.textContent || '');
    return clean(text.split(/(?:due|deadline|available|points?|grade)\b/i)[0]).slice(0, 180);
  }

  function candidateUrl(node) {
    const anchor = node.querySelector('a[href]');
    return anchor?.href && !anchor.href.startsWith('javascript:') ? anchor.href : location.href;
  }

  function itemKind(text) {
    const value = text.toLowerCase();
    if (/\bquiz\b|\bexam\b|\btest\b/.test(value)) return 'quiz';
    if (/\bdiscussion\b/.test(value)) return 'discussion';
    if (/\bmodule\b|\blesson\b/.test(value)) return 'module';
    if (/\bproject\b|\blab\b/.test(value)) return 'project';
    if (/\bassignment\b|\btask\b/.test(value)) return 'assignment';
    return 'coursework';
  }

  function isUsefulCandidate(node) {
    const text = clean(node.textContent || '');
    if (text.length < 8 || text.length > 1400) return false;
    return /\b(due|deadline|assignment|quiz|exam|discussion|task|project|module|lesson)\b/i.test(text);
  }

  function labeledCourseSection(labels) {
    const wanted = labels.map((label) => new RegExp(`^${label}(?:\\s|:|$)`, 'i'));
    const labelNodes = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], dt, strong, b, label, summary, span')]
      .filter((node) => wanted.some((pattern) => pattern.test(clean(node.textContent || ''))));
    for (const labelNode of labelNodes) {
      const labelText = clean(labelNode.textContent || '');
      const candidates = [
        labelNode.nextElementSibling?.textContent || '',
        labelNode.parentElement?.textContent || '',
        labelNode.parentElement?.parentElement?.textContent || '',
      ];
      for (const raw of candidates) {
        const value = clean(raw).replace(new RegExp(`^${labelText}\\s*[:\\-]?\\s*`, 'i'), '').trim();
        if (value.length >= 20 && value.length <= 2400 && !wanted.some((pattern) => pattern.test(value))) return value;
      }
    }
    return '';
  }

  function textCourseSection(startLabels, endLabels) {
    const text = clean(document.body?.innerText || document.body?.textContent || '');
    const start = new RegExp(`(?:${startLabels.join('|')})\\b`, 'ig');
    const end = new RegExp(`\\s+(?:${endLabels.join('|')})\\b`, 'i');
    let best = '';
    for (const match of text.matchAll(start)) {
      const remainder = text.slice(match.index + match[0].length).replace(/^\\s*[:\\-]?\\s*/, '');
      const endMatch = remainder.match(end);
      const value = clean(endMatch ? remainder.slice(0, endMatch.index) : remainder).slice(0, 2400);
      if (value.length > best.length && value.length >= 20) best = value;
    }
    return best;
  }

  function wguCompetencyNames() {
    const heading = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
      .find((node) => /^competencies$/i.test(clean(node.textContent || '')));
    if (!heading) return '';

    const planningHeading = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
      .find((node) => /^course planning tool$/i.test(clean(node.textContent || '')));
    const follows = (before, after) => Boolean(before?.compareDocumentPosition?.(after) & 4);
    const names = [];
    for (const button of [...document.querySelectorAll('button, [role="button"]')]) {
      if (!follows(heading, button) || (planningHeading && !follows(button, planningHeading))) continue;
      const nestedHeading = button.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      const name = clean(nestedHeading?.textContent || button.getAttribute?.('aria-label') || '');
      if (name && !/^competencies$/i.test(name)) names.push(name);
    }

    return [...new Set(names)].join('; ');
  }

  function courseContext(platform) {
    const courseLinks = [...document.querySelectorAll('a[href]')].filter((anchor) => {
      const href = anchor.href || '';
      return /\/courses\/(?:course\/)?\d+/i.test(href) && !/assignments|modules|quizzes|discussions/i.test(href) && clean(anchor.textContent).length > 1;
    });
    const brightspaceCourseLink = platform === 'brightspace'
      ? [...document.querySelectorAll('a[href]')].find((anchor) => /\/d2l\/home\/\d+(?:\/|$)/i.test(anchor.getAttribute('href') || ''))
      : null;
    const breadcrumbTitle = clean(brightspaceCourseLink?.textContent || courseLinks.at(-1)?.textContent || '');
    const heading = document.querySelector('main h1, #content h1, .d2l-page-title, [data-testid="course-title"], [data-testid*="course-name"], h1');
    const fallbackTitle = clean(heading?.textContent || '').replace(/\s+[-|–]\s+.+$/, '');
    const maestroPath = location.pathname.match(/\/learn\/([^/]+\/[^/]+)/i)?.[1] || '';
    const maestroBreadcrumbNode = platform === 'maestro'
      ? document.querySelector('[aria-label="breadcrumb"], [aria-label*="breadcrumb" i], [class*="Breadcrumb"]')
      : null;
    const maestroBreadcrumb = clean(maestroBreadcrumbNode?.textContent || '');
    const maestroLeaf = clean(maestroBreadcrumbNode?.querySelector('li:last-child')?.textContent || maestroBreadcrumb.split(/\s+/).at(-1) || '');
    const maestroCode = maestroLeaf.match(/\b[A-Z]{2,}\d{2,}[A-Z]?\b/)?.[0] || maestroLeaf;
    const courseTitle = platform === 'maestro'
      ? (maestroCode || clean(maestroBreadcrumb.split(/\s+/).at(-1) || '') || fallbackTitle || 'Imported course')
      : (breadcrumbTitle || fallbackTitle || clean(document.title).replace(/\s+[-|–]\s+.+$/, '') || 'Imported course');
    const codeMatch = courseTitle.match(/\b([A-Z]{1,6}\s?\d{2,4}[A-Z]?)\b/i);
    const courseCode = codeMatch ? codeMatch[1].replace(/\s/g, '').toUpperCase() : '';
    const canvasCourse = location.pathname.match(/\/courses\/(\d+)/i)?.[1];
    const moodleCourse = new URL(location.href).searchParams.get('id');
    const wguCourse = location.pathname.match(/\/courses\/course\/(\d+)/i)?.[1];
    const pageUrl = new URL(location.href);
    const brightspaceCourse = pageUrl.pathname.match(/\/d2l\/(?:home|le\/content)\/(\d+)(?:\/|$)/i)?.[1]
      || pageUrl.searchParams.get('ou');
    const maestroCourse = maestroPath || location.pathname.match(/\/learn\/([^/]+)/i)?.[1];
    const pageText = clean(document.body?.textContent || '');
    const startedText = pageText.match(/Course\s+Started\s*[-:]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1] || '';
    const courseDateRange = pageText.match(DATE_RANGE_PATTERN);
    const courseStartAt = parseDateValue(startedText || (courseDateRange ? `${courseDateRange[1]}/${courseDateRange[2]}/${courseDateRange[3]}` : ''));
    const courseEndAt = courseDateRange ? parseDateValue(`${courseDateRange[4]}/${courseDateRange[5]}/${courseDateRange[6]}`) : null;
    const courseWindowValid = Boolean(courseStartAt && courseEndAt && Date.parse(courseEndAt) > Date.parse(courseStartAt));
    const courseDescription = platform === 'wgu'
      ? (labeledCourseSection(['course description', 'description']) || textCourseSection(['course description', 'overview'], ['competencies', 'course competencies']))
      : '';
    const courseCompetencies = platform === 'wgu'
      ? (wguCompetencyNames() || labeledCourseSection(['course competencies', 'competencies', 'course objectives', 'objectives']) || textCourseSection(['course competencies', 'competencies', 'course objectives', 'objectives'], ['course materials', 'course tips', 'assessments', 'resources', 'pacing guide']))
      : '';
    const sourceKey = canvasCourse ? `canvas:${canvasCourse}`
      : moodleCourse ? `moodle:${moodleCourse}`
        : wguCourse ? `wgu:${wguCourse}`
          : maestroCourse ? `maestro:${maestroCourse}`
            : platform === 'brightspace' && brightspaceCourse ? `brightspace:${location.origin}/d2l/home/${brightspaceCourse}`
              : `${platform}:${location.origin}${location.pathname}`;
    return { courseTitle, courseCode, courseSourceId: `browser:${sourceKey}`, courseStartAt, courseEndAt, courseWindowValid, courseDescription, courseCompetencies };
  }

  function parseWguDate(value) {
    const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!match) return null;
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const month = Number(match[1]);
    const day = Number(match[2]);
    return parseDateValue(`${month}/${day}/${year}`);
  }

  function scanWguTermPage() {
    const termCourses = [];
    for (const anchor of [...document.querySelectorAll('a[href*="/courses/course/"]')]) {
      let container = anchor.parentElement;
      let text = '';
      while (container && container !== document.body) {
        const candidate = clean(container.textContent || '');
        if (DATE_RANGE_PATTERN.test(candidate)) { text = candidate; break; }
        container = container.parentElement;
      }
      const dateRange = text.match(DATE_RANGE_PATTERN);
      if (!dateRange) continue;
      const title = clean(text.slice(0, dateRange.index).slice(text.slice(0, dateRange.index).lastIndexOf(')') + 1)) || clean(anchor.textContent || '');
      const codeMatch = title.match(/\b([A-Z]{1,6}\s?\d{2,4}[A-Z]?)\b/i);
      const courseCode = codeMatch ? codeMatch[1].replace(/\s/g, '').toUpperCase() : '';
      const courseId = anchor.href.match(/\/courses\/course\/(\d+)/i)?.[1];
      const courseStartAt = parseWguDate(`${dateRange[1]}/${dateRange[2]}/${dateRange[3]}`);
      const courseEndAt = parseWguDate(`${dateRange[4]}/${dateRange[5]}/${dateRange[6]}`);
      termCourses.push({
        courseTitle: title,
        courseCode,
        courseSourceId: courseId ? `browser:wgu:${courseId}` : `browser:wgu:${courseCode || title}`,
        courseStartAt,
        courseEndAt,
        courseWindowValid: Boolean(courseStartAt && courseEndAt && Date.parse(courseEndAt) > Date.parse(courseStartAt)),
      });
    }
    return { platform: 'wgu', isWguTermPage: true, courseTitle: 'WGU term courses', courseCode: '', courseSourceId: 'browser:wgu:term', url: location.href, capturedAt: new Date().toISOString(), scheduleSource: 'wgu_term_page', termCourses, items: [] };
  }

  function wguPacingGuideUrl() {
    const links = [...document.querySelectorAll('a[href]')];
    const guide = links.find((anchor) => {
      const text = clean(anchor.textContent || '');
      const href = anchor.href || '';
      return /pacing|pace/i.test(`${text} ${href}`) && /wguconnect\.wgu\.edu/i.test(href);
    });
    return guide?.href || '';
  }

  function wguAssessmentItems(context) {
    return [...document.querySelectorAll('a[href]')]
      .filter((anchor) => /tasks\.wgu\.edu/i.test(anchor.href || ''))
      .map((anchor, index) => {
        const label = clean(anchor.closest('div, li')?.textContent || anchor.textContent || `Performance Task ${index + 1}`);
        const taskMatch = label.match(/Task\s+\d+/i);
        const title = taskMatch ? `WGU ${taskMatch[0]}` : `WGU Performance Task ${index + 1}`;
        return {
          id: `school-wgu-${btoa(unescape(encodeURIComponent(`${context.courseSourceId}|assessment:${anchor.href}`))).replace(/=+$/g, '').slice(0, 48)}`,
          title,
          dueAt: null,
          dueText: 'No direct due date on the course page',
          kind: 'assignment',
          sourceUrl: anchor.href,
          selected: false,
        };
      });
  }

  function maestroDateRange(value, year = new Date().getFullYear()) {
    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
      may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
      sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
      dec: 12, december: 12,
    };
    const match = clean(value).match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]{3,9})\s+(\d{1,2})/);
    if (!match) return null;
    const startMonth = months[match[1].toLowerCase()];
    const endMonth = months[match[3].toLowerCase()];
    const startDay = Number(match[2]);
    const endDay = Number(match[4]);
    if (!startMonth || !endMonth || !startDay || !endDay) return null;
    const endYear = endMonth < startMonth ? year + 1 : year;
    const start = new Date(Date.UTC(year, startMonth - 1, startDay, 12));
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay, 12));
    if (end <= start) return null;
    return { start, end, startAt: start.toISOString(), endAt: end.toISOString(), label: `${match[1]} ${startDay} - ${match[3]} ${endDay}` };
  }

  function maestroListScroller() {
    return [...document.querySelectorAll('body *')]
      .filter((node) => node.scrollHeight > node.clientHeight + 100 && node.clientHeight > 250)
      .filter((node) => /\bWeek\b/.test(clean(node.textContent || '')))
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || null;
  }

  function maestroWeekHeaders() {
    return [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter((heading) => /^\d{1,2}$/.test(clean(heading.textContent || '')))
      .map((heading) => {
        const root = heading.parentElement?.parentElement || heading.parentElement;
        const rootText = clean(root?.textContent || '');
        const week = Number(clean(heading.textContent || ''));
        const dateText = root?.querySelector?.('[id*="unit-dates"]')?.textContent || rootText;
        const range = maestroDateRange(dateText);
        const siblingHeadings = [...(root?.querySelectorAll?.('h1, h2, h3, h4, h5, h6') || [])]
          .map((node) => clean(node.textContent || ''))
          .filter((value) => value && value !== String(week).padStart(2, '0'));
        return { node: heading, week, subject: siblingHeadings[0] || `Week ${week}`, range };
      })
      .filter((header) => header.range);
  }

  function maestroCardsInView() {
    const headers = maestroWeekHeaders();
    const cards = [];
    for (const card of [...document.querySelectorAll('[href*="/learn/"]')]) {
      const href = card.getAttribute('href') || '';
      if (!/\/learn\/[^/]+\/[^/]+\/[^/]+/.test(href)) continue;
      const header = headers.filter((candidate) => Boolean(candidate.node.compareDocumentPosition(card) & 4)).at(-1);
      if (!header) continue;
      const textParts = [...card.querySelectorAll('p')].map((node) => clean(node.textContent || '')).filter(Boolean);
      const label = textParts.find((value) => /^Lesson\s+\d+$/i.test(value)) || textParts.find((value) => /^Review$/i.test(value)) || '';
      const title = textParts.find((value) => value !== label && !/^\d+\s+100$/.test(value)) || clean(card.textContent || '').replace(/^\d+\s*\d+\s*/i, '').replace(/^Lesson\s+\d+\s*/i, '').replace(/^Review\s*/i, '');
      if (!label || !title) continue;
      cards.push({
        key: href,
        href,
        week: header.week,
        subject: header.subject,
        range: header.range,
        label,
        title,
      });
    }
    return cards;
  }

  function maestroSyllabusRoot() {
    return document.querySelector('[role="dialog"]');
  }

  function maestroSyllabusSection(root, label) {
    const heading = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .find((node) => clean(node.textContent || '').toLowerCase() === label.toLowerCase());
    if (!heading) return '';
    const parts = [];
    for (let node = heading.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/i.test(node.tagName)) break;
      const children = [...(node.children || [])];
      const sourceNodes = children.some((child) => /^H[1-6]$/i.test(child.tagName || '')) ? children : [node];
      for (const sourceNode of sourceNodes) {
        if (/^H[1-6]$/i.test(sourceNode.tagName || '')) break;
        const listItems = [...(sourceNode.querySelectorAll?.('li') || [])]
          .map((item) => clean(item.textContent || ''))
          .filter(Boolean);
        if (listItems.length) parts.push(listItems.join('; '));
        else if (sourceNode.textContent) parts.push(clean(sourceNode.textContent));
      }
    }
    return clean(parts.join(' '));
  }

  async function scanMaestroSyllabus(context) {
    const syllabusButton = [...document.querySelectorAll('button')]
      .find((button) => /^course\s+syllabus$/i.test(clean(button.textContent || '')));
    const alreadyOpen = Boolean(maestroSyllabusRoot());
    if (!alreadyOpen && syllabusButton) {
      syllabusButton.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const root = maestroSyllabusRoot();
    if (!root) return context;

    const heading = [...root.querySelectorAll('h1, h2')]
      .find((node) => /\b[A-Z]{2,}\d{2,}[A-Z]?\b\s*[·•]/.test(clean(node.textContent || '')))
      || root.querySelector('h1, h2');
    const headingText = clean(heading?.textContent || '');
    const titleMatch = headingText.match(/^([A-Z]{2,}\d{2,}[A-Z]?)\s*[·•]\s*(.+)$/);
    const courseCode = titleMatch?.[1]?.toUpperCase() || context.courseCode;
    const courseTitle = clean(titleMatch?.[2] || headingText || context.courseTitle);
    const courseDescription = maestroSyllabusSection(root, 'Course Description');
    const courseCompetencies = maestroSyllabusSection(root, 'Course Objectives');

    if (!alreadyOpen) {
      const closeButton = [...root.querySelectorAll('button')]
        .find((button) => /^close$/i.test(clean(button.textContent || '')));
      closeButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      ...context,
      courseTitle: courseTitle || context.courseTitle,
      courseCode: courseCode || context.courseCode,
      courseDescription: courseDescription || context.courseDescription || '',
      courseCompetencies: courseCompetencies || context.courseCompetencies || '',
      syllabusImported: Boolean(courseDescription || courseCompetencies || titleMatch),
      syllabusSource: 'maestro_course_syllabus',
    };
  }

  async function scanMaestroPage(context) {
    context = await scanMaestroSyllabus(context);
    const scroller = maestroListScroller();
    const originalTop = scroller?.scrollTop || 0;
    const positions = [];
    if (scroller) {
      const step = Math.max(280, Math.floor(scroller.clientHeight * 0.8));
      for (let position = 0; position <= scroller.scrollHeight - scroller.clientHeight; position += step) positions.push(position);
      positions.push(scroller.scrollHeight - scroller.clientHeight);
    } else positions.push(0);

    const cards = new Map();
    for (const position of [...new Set(positions)]) {
      if (scroller) scroller.scrollTop = position;
      await new Promise((resolve) => setTimeout(resolve, 180));
      for (const card of maestroCardsInView()) cards.set(card.key, card);
    }
    if (scroller) {
      scroller.scrollTop = originalTop;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const grouped = [...cards.values()].sort((a, b) => a.week - b.week || a.label.localeCompare(b.label) || a.title.localeCompare(b.title));
    const lastReviewKey = [...grouped].reverse().find((card) => /^Review$/i.test(card.label))?.key;
    const items = [];
    const groups = new Map();
    grouped.forEach((card) => {
      const groupKey = `${card.week}|${card.subject}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(card);
    });
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const aNumber = Number(a.label.match(/\d+/)?.[0] || 999);
        const bNumber = Number(b.label.match(/\d+/)?.[0] || 999);
        return aNumber - bNumber;
      });
      const range = group[0].range;
      const groupKey = `${group[0].week}|${group[0].subject}`;
      // DueVinci stores the week number separately as unit_number and adds
      // the unit/week badge in its coursework view. Keep the imported title
      // as the actual subject name so the UI does not render "Unit 7 Unit 7".
      const unitTitle = group[0].subject || 'Coursework';
      const unitDueAt = range.endAt;
      items.push({
        id: stableItemId('school-maestro-unit', `${context.courseSourceId}|unit|${groupKey}`),
        title: unitTitle,
        dueAt: unitDueAt,
        dueText: `${range.label} unit target`,
        dueIsEstimated: false,
        kind: 'unit',
        sourceUrl: new URL(group[0].href, location.href).href,
        selected: true,
        week: group[0].week,
        source: 'maestro_course_page',
      });
      group.forEach((card) => {
        const review = /^Review$/i.test(card.label);
        const finalExam = card.key === lastReviewKey;
        const title = card.title.replace(/^Review:\s*/i, '');
        const childTitle = finalExam
          ? `↳ Exam: ${title}`
          : review
            ? `↳ Review: ${title}`
            : `↳ ${card.label}: ${title}`;
        items.push({
          id: stableItemId('school-maestro', `${context.courseSourceId}|${card.key}`),
          title: childTitle,
          dueAt: unitDueAt,
          dueText: `${range.label} unit target`,
          dueIsEstimated: false,
          kind: finalExam ? 'quiz' : review ? 'review' : itemKind(`${card.label} ${card.title}`),
          sourceUrl: new URL(card.href, location.href).href,
          selected: true,
          week: card.week,
          source: 'maestro_course_page',
        });
      });
    }
    const ranges = grouped.map((card) => card.range).filter(Boolean);
    const start = ranges.sort((a, b) => a.start - b.start)[0];
    const end = ranges.sort((a, b) => b.end - a.end)[0];
    return {
      platform: 'maestro',
      ...context,
      courseStartAt: start?.startAt || context.courseStartAt || null,
      courseEndAt: end?.endAt || context.courseEndAt || null,
      courseWindowValid: Boolean(start && end && end.end > start.start),
      pacingType: 'weekly',
      pacingSource: 'maestro_page',
      url: location.href,
      capturedAt: new Date().toISOString(),
      items: items.slice(0, MAX_MAESTRO_ITEMS),
    };
  }

  function scanWguCoursePage(context) {
    const pacingGuideUrl = wguPacingGuideUrl();
    const items = wguAssessmentItems(context);
    return {
      platform: 'wgu',
      ...context,
      url: location.href,
      capturedAt: new Date().toISOString(),
      pacingGuideUrl,
      requiresPacingGuide: Boolean(pacingGuideUrl),
      scheduleSource: context.courseStartAt || context.courseEndAt ? 'wgu_course_page' : null,
      items,
    };
  }

  function brightspaceWeekNumber(value) {
    const match = clean(value).match(/\b(?:week|module)\s*#?\s*(\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
    if (!match) return null;
    const wordNumbers = { first: 1, one: 1, second: 2, two: 2, third: 3, three: 3, fourth: 4, four: 4, fifth: 5, five: 5, sixth: 6, six: 6, seventh: 7, seven: 7, eighth: 8, eight: 8, ninth: 9, nine: 9, tenth: 10, ten: 10 };
    return Number(match[1]) || wordNumbers[match[1].toLowerCase()] || null;
  }

  function scanBrightspaceContentPage(context) {
    const links = [...document.querySelectorAll('a[href]')].filter((anchor) => /\/d2l\/le\/content\/\d+\/viewContent\/\d+/i.test(anchor.getAttribute('href') || ''));
    const headings = [...document.querySelectorAll('main h2, main h3, h2, h3')];
    const seen = new Set();
    const items = [];

    for (const anchor of links) {
      const sourceUrl = anchor.href;
      if (!sourceUrl || seen.has(sourceUrl) || items.length >= MAX_ITEMS) continue;
      seen.add(sourceUrl);

      const title = clean(anchor.textContent || anchor.getAttribute('title')?.replace(/^['\"]|['\"]$/g, '') || '');
      if (!title || title.length > 180) continue;

      const topic = anchor.closest('.d2l-topic-view') || anchor.parentElement;
      const titleMetadata = clean(anchor.getAttribute('title') || '');
      const typeLabel = titleMetadata.match(/\s-\s(.+)$/)?.[1]
        || clean(topic?.querySelector('.d2l-container-icon')?.textContent || '');
      const moduleHeading = headings
        .filter((heading) => Boolean(heading.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING))
        .at(-1);
      const moduleName = clean(moduleHeading?.textContent || '');
      const sourceText = `${title} ${typeLabel}`;
      const parsedKind = itemKind(sourceText);
      const due = dueDetails(clean(topic?.innerText || topic?.textContent || ''));
      const stableKey = `${context.courseSourceId}|${sourceUrl}`;

      items.push({
        id: `school-brightspace-${btoa(unescape(encodeURIComponent(stableKey))).replace(/=+$/g, '').slice(0, 48)}`,
        title,
        dueAt: due.dueAt,
        dueText: due.dueText,
        kind: parsedKind === 'coursework' || parsedKind === 'module' ? 'lesson' : parsedKind,
        sourceUrl,
        selected: true,
        week: brightspaceWeekNumber(moduleName),
        source: 'brightspace_learning_modules',
      });
    }

    const onCourseHome = /\/d2l\/home\/\d+(?:\/|$)/i.test(location.pathname);
    return {
      platform: 'brightspace',
      ...context,
      url: location.href,
      capturedAt: new Date().toISOString(),
      items,
      scanHint: items.length ? '' : onCourseHome
        ? 'This SNHU course home shows the course shell. Open Course Menu → Learning Modules or Assignments, then scan that page.'
        : 'No coursework links were visible here. Open Course Menu → Learning Modules or Assignments, then scan that page.',
    };
  }

  async function scanPage(sourceOverride = 'auto') {
    const platform = platformForPage(sourceOverride);
    const looksLikeWguTermPage = /\/home(?:\/|$)/i.test(location.pathname)
      || (location.pathname === '/' && document.querySelector('a[href*="/courses/course/"]'));
    if (platform === 'wgu' && looksLikeWguTermPage) return scanWguTermPage();
    const context = courseContext(platform);
    if (platform === 'wgu') return scanWguCoursePage(context);
    if (platform === 'maestro') return scanMaestroPage(context);
    if (platform === 'brightspace' && /\/d2l\/le\/content\/\d+\/Home(?:\/|$)/i.test(location.pathname)) return scanBrightspaceContentPage(context);
    const selectors = [...(PLATFORM_SELECTORS[platform] || []), ...PLATFORM_SELECTORS.generic];
    const nodes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const seen = new Set();
    const items = [];

    for (const node of nodes) {
      if (items.length >= MAX_ITEMS || !isUsefulCandidate(node)) continue;
      const fullText = clean(node.textContent || '');
      const title = candidateTitle(node);
      if (!title || /^(home|modules?|assignments?|grades?|coursework)$/i.test(title)) continue;
      const due = dueDetails(fullText);
      const key = `${title.toLowerCase()}|${due.dueText.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sourceUrl = candidateUrl(node);
      const stableItemKey = sourceUrl !== location.href ? sourceUrl : key;
      const idKey = `${context.courseSourceId}|${stableItemKey}`;
      items.push({
        id: `school-${platform}-${btoa(unescape(encodeURIComponent(idKey))).replace(/=+$/g, '').slice(0, 48)}`,
        title,
        dueAt: due.dueAt,
        dueText: due.dueText,
        kind: itemKind(fullText),
        sourceUrl,
        selected: true,
      });
    }

    const scanHint = platform === 'brightspace' && !items.length
      ? /\/d2l\/home\/\d+(?:\/|$)/i.test(location.pathname)
        ? 'This SNHU course home shows the course shell. Open Course Menu → Learning Modules or Assignments, then scan that page.'
        : 'No coursework was visible here. Open Course Menu → Learning Modules or Assignments, then scan that page.'
      : '';
    return { platform, ...context, url: location.href, capturedAt: new Date().toISOString(), items, scanHint };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'DUEVINCI_SCAN_PAGE') return undefined;
    Promise.resolve().then(() => scanPage(message.sourceOverride || 'auto'))
      .then((scan) => sendResponse({ ok: true, scan }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'The course page could not be scanned.' }));
    return true;
  });
})();
