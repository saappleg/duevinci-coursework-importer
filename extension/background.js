const SUPABASE_URL = 'https://lzmsguzlmjmedlaybckc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RMNFdMwGYzdOGBCMLgqO9Q_HhiHkEpZ';
const DUEVINCI_TAB_PATTERNS = ['https://duevinci.tech/*', 'https://*.duevinci.tech/*'];
const WGU_SCHEDULE_STORAGE_KEY = 'wguTermSchedule';

function extensionStorage() {
  return globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local || null;
}

function getActiveTab() {
  return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url) throw new Error('Open the course page you want to import from, then try again.');
    if (!/^https?:/i.test(tab.url)) throw new Error('This page cannot be scanned. Open a course page on your school site first.');
    return tab;
  });
}

async function readSessionFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const keys = Object.keys(localStorage).filter((key) => /auth-token/i.test(key));
      for (const key of keys) {
        try {
          const value = JSON.parse(localStorage.getItem(key) || '');
          if (value?.access_token && value?.user?.id) {
            return { accessToken: value.access_token, userId: value.user.id, email: value.user.email || '' };
          }
        } catch {
          // Ignore unrelated local-storage values.
        }
      }
      return null;
    },
  });
  return results?.[0]?.result || null;
}

async function getDueVinciSession() {
  const tabs = await chrome.tabs.query({ url: DUEVINCI_TAB_PATTERNS });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const session = await readSessionFromTab(tab.id);
      if (session) return session;
    } catch {
      // A tab may be on a restricted page or still loading; try the next tab.
    }
  }
  return null;
}

async function scanActiveTab(sourceOverride = 'auto') {
  const tab = await getActiveTab();
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scanner.js'] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'DUEVINCI_SCAN_PAGE', sourceOverride });
    if (!result?.ok) throw new Error(result?.error || 'No coursework could be read from this page.');
    const scan = result.scan;
    if (scan.platform === 'wgu' && scan.isWguTermPage) {
      const scheduleSaved = await saveWguTermSchedule(scan);
      return { ...scan, scheduleSaved, scheduleStorageAvailable: Boolean(extensionStorage()), scheduleCount: scan.termCourses?.length || 0 };
    }
    if (scan.platform === 'wgu' && !scan.isWguTermPage) return enrichWguSchedule(scan);
    return scan;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to scan this course page.';
    if (/Receiving end does not exist|Could not establish connection/i.test(message)) {
      throw new Error('The course page was not ready. Refresh it once, then scan again.');
    }
    throw new Error(message);
  }
}

function normalizeWguValue(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findWguScheduleMatch(scan, courses = []) {
  const scanCode = normalizeWguValue(scan.courseCode);
  const scanTitle = normalizeWguValue(scan.courseTitle);
  return courses.find((course) => {
    const courseCode = normalizeWguValue(course.courseCode);
    if (course.courseSourceId && course.courseSourceId === scan.courseSourceId) return true;
    if (scanCode && courseCode && scanCode === courseCode) return true;
    const courseTitle = normalizeWguValue(course.courseTitle);
    return Boolean(scanTitle && courseTitle && (scanTitle.includes(courseTitle) || courseTitle.includes(scanTitle)));
  });
}

async function readSavedWguTermSchedule() {
  const storage = extensionStorage();
  if (!storage) return null;
  const stored = await storage.get({ [WGU_SCHEDULE_STORAGE_KEY]: null });
  return stored[WGU_SCHEDULE_STORAGE_KEY] || null;
}

async function saveWguTermSchedule(scan) {
  const courses = (scan.termCourses || []).filter((course) => course.courseStartAt && course.courseEndAt && course.courseWindowValid !== false);
  if (!courses.length) return false;
  const storage = extensionStorage();
  if (!storage) return false;
  await storage.set({
    [WGU_SCHEDULE_STORAGE_KEY]: {
      capturedAt: new Date().toISOString(),
      sourceUrl: scan.url,
      courses,
    },
  });
  return true;
}

function applyWguSchedule(scan, match, capturedAt) {
  if (!match) return scan;
  return {
    ...scan,
    courseStartAt: match.courseStartAt || scan.courseStartAt,
    courseEndAt: match.courseEndAt || scan.courseEndAt,
    courseWindowValid: match.courseWindowValid,
    scheduleSource: 'wgu_term_schedule',
    scheduleCapturedAt: capturedAt || null,
    termScheduleMatched: true,
  };
}

async function enrichWguSchedule(scan) {
  const saved = await readSavedWguTermSchedule();
  const savedMatch = findWguScheduleMatch(scan, saved?.courses || []);
  if (savedMatch) return applyWguSchedule(scan, savedMatch, saved.capturedAt);

  const homeTabs = await chrome.tabs.query({ url: ['https://my.wgu.edu/home*', 'https://my.wgu.edu/'] });
  for (const tab of homeTabs) {
    if (!tab.id) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scanner.js'] });
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'DUEVINCI_SCAN_PAGE' });
      const termScan = result?.ok && result.scan?.isWguTermPage ? result.scan : null;
      if (!termScan) continue;
      await saveWguTermSchedule(termScan);
      const match = findWguScheduleMatch(scan, termScan.termCourses);
      if (match) return applyWguSchedule(scan, match, termScan.capturedAt);
    } catch {
      // Keep the course-page scan if the home page is still loading or restricted.
    }
  }
  return scan;
}

function taskTypeFor(item) {
  if (item.kind === 'quiz') return 'exam';
  if (item.kind === 'review') return 'review';
  if (item.kind === 'project') return 'lab';
  return 'lesson';
}

function dateOnly(value) {
  if (!value) return null;
  const isoDate = String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

async function supabaseRequest(path, accessToken, method, body, prefer = '') {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${SUPABASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const detail = typeof result === 'string' ? result.slice(0, 180) : result?.message || result?.hint || result?.details;
    throw new Error(detail ? `DueVinci returned ${response.status}: ${detail}` : `DueVinci returned ${response.status}.`);
  }
  return result;
}

async function importCoursework(scan, coursework) {
  const session = await getDueVinciSession();
  if (!session) return { ok: false, code: 'DUEVINCI_NOT_CONNECTED', error: 'Open duevinci.tech in a tab and sign in before importing.' };

  const now = new Date().toISOString();
  const provider = `browser_${scan.platform}`;
  const courseCode = scan.platform === 'maestro' && scan.courseCode && scan.courseTitle && scan.courseTitle !== scan.courseCode
    ? `${scan.courseCode} · ${scan.courseTitle}`
    : scan.courseCode || scan.courseTitle || 'Imported course';
  const coursePayload = [{
    user_id: session.userId,
    name: scan.courseTitle || 'Imported course',
    code: courseCode,
    emoji: '📚',
    color: '#0f766e',
    lms_source_id: scan.courseSourceId || scan.url,
    lms_provider: provider,
    start_date: dateOnly(scan.courseStartAt),
    end_date: dateOnly(scan.courseEndAt),
    pacing_type: (scan.platform === 'wgu' && (scan.pacingGuideImported || scan.requiresPacingGuide)) || scan.platform === 'maestro' ? 'weekly' : null,
    pacing_source: scan.platform === 'maestro' ? 'maestro_page' : (scan.termScheduleMatched ? 'wgu_term_page' : (scan.pacingGuideImported ? 'wgu_pacing_guide' : null)),
    updated_at: now,
  }];
  if (scan.courseDescription) coursePayload[0].description = scan.courseDescription;
  if (scan.courseCompetencies) coursePayload[0].objectives = scan.courseCompetencies;

  try {
    let metadataPersisted = true;
    let savedCourses;
    try {
      savedCourses = await supabaseRequest('/rest/v1/courses?on_conflict=user_id,lms_source_id', session.accessToken, 'POST', coursePayload, 'resolution=merge-duplicates,return=representation');
    } catch (error) {
      // Keep older DueVinci deployments importable while the pacing migration is being rolled out.
      if (!/start_date|end_date|pacing_type|pacing_source|column/i.test(error?.message || '')) throw error;
      metadataPersisted = false;
      const legacyCoursePayload = coursePayload.map(({ start_date, end_date, pacing_type, pacing_source, ...course }) => course);
      savedCourses = await supabaseRequest('/rest/v1/courses?on_conflict=user_id,lms_source_id', session.accessToken, 'POST', legacyCoursePayload, 'resolution=merge-duplicates,return=representation');
    }
    const savedCourse = Array.isArray(savedCourses) ? savedCourses[0] : null;
    if (!savedCourse?.id) throw new Error('DueVinci did not return the imported course ID.');

    const assignmentPayload = coursework.map((item) => ({
      user_id: session.userId,
      course_id: savedCourse.id,
      title: item.title,
      unit_number: item.week || null,
      due_date: item.dueAt || null,
      task_type: taskTypeFor(item),
      type: taskTypeFor(item),
      priority: 'medium',
      is_completed: false,
      lms_source_id: item.id,
      lms_provider: provider,
      lms_updated_at: now,
    }));
    // Keep a malformed or repeated scan from sending the same conflict key
    // twice in one PostgREST upsert request.
    const uniqueAssignments = [...new Map(assignmentPayload.map((item) => [item.lms_source_id || `${item.title}|${item.due_date || ''}`, item])).values()];
    if (uniqueAssignments.length) {
      await supabaseRequest('/rest/v1/assignments?on_conflict=user_id,lms_source_id', session.accessToken, 'POST', uniqueAssignments, 'resolution=merge-duplicates,return=minimal');
    }
    return { ok: true, imported: uniqueAssignments.length, courseName: scan.courseTitle, metadataPersisted };
  } catch (error) {
    return { ok: false, code: 'IMPORT_FAILED', error: error instanceof Error ? error.message : 'DueVinci could not import this coursework.' };
  }
}

async function connectDueVinci() {
  const tabs = await chrome.tabs.query({ url: DUEVINCI_TAB_PATTERNS });
  if (!tabs.length) {
    await chrome.tabs.create({ url: 'https://duevinci.tech/' });
    return { ok: false, code: 'OPENED_DUEVINCI', error: 'DueVinci opened in a new tab. Sign in, then click Connect again.' };
  }
  const session = await getDueVinciSession();
  if (!session) return { ok: false, code: 'DUEVINCI_NOT_SIGNED_IN', error: 'Sign in to DueVinci in its open tab, then click Connect again.' };
  return { ok: true, email: session.email };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'DUEVINCI_SCAN_ACTIVE_TAB') {
    scanActiveTab(message.sourceOverride || 'auto').then((scan) => sendResponse({ ok: true, scan })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'DUEVINCI_CONNECT') {
    connectDueVinci().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'DUEVINCI_IMPORT') {
    importCoursework(message.scan, message.coursework).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return undefined;
});
