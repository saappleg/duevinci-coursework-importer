const state = { scan: null, connected: false, scanning: false, importing: false };
const $ = (id) => document.getElementById(id);

function setStatus(message, tone = '') {
  const status = $('status');
  status.textContent = message;
  status.className = `status ${tone ? `is-${tone}` : ''}`;
}

function prettyPlatform(platform) {
  if (platform === 'generic') return 'Course page';
  if (platform === 'wgu') return 'WGU pacing guide';
  return `${platform[0].toUpperCase()}${platform.slice(1)} page`;
}

const SOURCE_PREFERENCE_KEY = 'preferredImportSource';
const PENDING_GUIDE_KEY = 'pendingWguGuideScan';
const BETA_ANNOUNCEMENT_VERSION = '0.1.0';
const BETA_ANNOUNCEMENT_KEY = `betaAnnouncementDismissed:${BETA_ANNOUNCEMENT_VERSION}`;
const SOURCE_OPTIONS = new Set(['auto', 'wgu', 'maestro', 'canvas', 'moodle', 'blackboard', 'brightspace', 'generic']);

function extensionStorage() {
  return globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local || null;
}

async function betaAnnouncementDismissed() {
  const storage = extensionStorage();
  if (storage) {
    try {
      const stored = await storage.get({ [BETA_ANNOUNCEMENT_KEY]: false });
      if (stored[BETA_ANNOUNCEMENT_KEY]) return true;
    } catch { /* Use the popup-local fallback. */ }
  }
  try { return localStorage.getItem(BETA_ANNOUNCEMENT_KEY) === 'true'; } catch { return false; }
}

async function dismissBetaAnnouncement() {
  const storage = extensionStorage();
  if (storage) {
    try { await storage.set({ [BETA_ANNOUNCEMENT_KEY]: true }); } catch { /* Use the popup-local fallback. */ }
  }
  try { localStorage.setItem(BETA_ANNOUNCEMENT_KEY, 'true'); } catch { /* Optional fallback. */ }
  $('beta-announcement')?.classList.add('is-hidden');
}

async function renderBetaAnnouncement() {
  if (!(await betaAnnouncementDismissed())) $('beta-announcement')?.classList.remove('is-hidden');
}

function saveSourcePreference(value) {
  const storage = extensionStorage();
  if (storage) storage.set({ [SOURCE_PREFERENCE_KEY]: value }).catch(() => {});
  try { localStorage.setItem(SOURCE_PREFERENCE_KEY, value); } catch { /* Optional fallback. */ }
}

async function loadSourcePreference() {
  const storage = extensionStorage();
  if (storage) {
    try {
      const stored = await storage.get({ [SOURCE_PREFERENCE_KEY]: 'auto' });
      if (SOURCE_OPTIONS.has(stored[SOURCE_PREFERENCE_KEY])) return stored[SOURCE_PREFERENCE_KEY];
    } catch { /* Use the popup-local fallback. */ }
  }
  try {
    const value = localStorage.getItem(SOURCE_PREFERENCE_KEY);
    if (SOURCE_OPTIONS.has(value)) return value;
  } catch { /* Use auto-detect. */ }
  return 'auto';
}

async function savePendingGuideScan(scan) {
  const payload = { ...scan, pendingGuideSavedAt: new Date().toISOString() };
  const storage = extensionStorage();
  if (storage) {
    try { await storage.set({ [PENDING_GUIDE_KEY]: payload }); } catch { /* Use popup-origin storage below. */ }
  }
  try { localStorage.setItem(PENDING_GUIDE_KEY, JSON.stringify(payload)); } catch { /* Optional fallback. */ }
}

async function loadPendingGuideScan() {
  const storage = extensionStorage();
  if (storage) {
    try {
      const stored = await storage.get({ [PENDING_GUIDE_KEY]: null });
      if (stored[PENDING_GUIDE_KEY]?.items?.length) return stored[PENDING_GUIDE_KEY];
    } catch { /* Use popup-origin storage below. */ }
  }
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_GUIDE_KEY) || 'null');
    return value?.items?.length ? value : null;
  } catch {
    return null;
  }
}

async function clearPendingGuideScan() {
  const storage = extensionStorage();
  if (storage) {
    try { await storage.remove(PENDING_GUIDE_KEY); } catch { /* Optional cleanup. */ }
  }
  try { localStorage.removeItem(PENDING_GUIDE_KEY); } catch { /* Optional cleanup. */ }
}

async function restorePendingGuideScan() {
  const pending = await loadPendingGuideScan();
  if (!pending) return false;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeUrl = tabs[0]?.url || '';
  if (activeUrl && pending.url && new URL(activeUrl).origin + new URL(activeUrl).pathname !== new URL(pending.url).origin + new URL(pending.url).pathname) return false;
  state.scan = pending;
  renderReview();
  setStatus(`${pending.items.length} pacing-guide item${pending.items.length === 1 ? '' : 's'} loaded. Connect DueVinci, then click Import selected.`, 'success');
  return true;
}

function formatDate(value, includeTime = true) {
  if (!value) return null;
  const text = String(value);
  // Date-only ISO values represent calendar days, not UTC instants. Parsing
  // them with `new Date('YYYY-MM-DD')` shifts the display to the prior day in
  // US time zones, so create a local-noon value for stable calendar output.
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T00:00:00(?:\.000)?Z$)/)?.[1];
  const date = dateOnly ? new Date(`${dateOnly}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(undefined, includeTime ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function selectedCoursework() { return state.scan?.items.filter((item) => item.selected) || []; }

function renderPacingGuidePanel() {
  const panel = $('pacing-guide-panel');
  const shouldShow = Boolean(state.scan?.platform === 'wgu' && state.scan?.requiresPacingGuide && state.scan?.pacingGuideUrl);
  panel.classList.toggle('is-hidden', !shouldShow);
}

function renderCourseWindow() {
  const panel = $('course-window');
  const dates = $('course-window-dates');
  const source = $('course-window-source');
  const weekMap = $('course-week-map');
  const scan = state.scan;
  const hasWindow = Boolean(scan?.courseStartAt || scan?.courseEndAt);
  panel.classList.toggle('is-hidden', !hasWindow);
  if (!hasWindow) return;
  const start = formatDate(scan.courseStartAt, false) || 'Unknown start';
  const end = formatDate(scan.courseEndAt, false) || 'Unknown end';
  const valid = scan.courseWindowValid !== false && Boolean(scan.courseStartAt && scan.courseEndAt);
  const verified = valid && (scan.termScheduleMatched || scan.platform === 'maestro');
  const sourceText = scan.termScheduleMatched ? 'Matched from the WGU term page.' : scan.platform === 'maestro' ? 'Read from Maestro weekly ranges.' : valid ? 'Verify this window before importing.' : 'A complete course window was not found.';
  dates.textContent = `${start} – ${end}. ${sourceText}`;
  source.textContent = verified ? 'Verified' : 'Needs review';
  source.style.color = verified ? '#0f716a' : '#a4792c';
  weekMap.replaceChildren();
  const weeks = [...new Map((scan.items || []).filter((item) => item.week && item.dueAt).map((item) => [item.week, item.dueAt])).entries()].sort((a, b) => a[0] - b[0]);
  weeks.forEach(([week, dueAt]) => {
    const chip = document.createElement('span');
    chip.textContent = `Week ${week} · ${formatDate(dueAt, false)}`;
    weekMap.append(chip);
  });
}

function renderCourseMetadata() {
  const panel = $('course-metadata');
  const description = $('course-description');
  const competencies = $('course-competencies');
  const scan = state.scan;
  const hasDescription = Boolean(scan?.courseDescription);
  const hasCompetencies = Boolean(scan?.courseCompetencies);
  panel.classList.toggle('is-hidden', !hasDescription && !hasCompetencies);
  description.textContent = hasDescription ? `Description: ${scan.courseDescription}` : '';
  competencies.textContent = hasCompetencies ? `Competencies: ${scan.courseCompetencies}` : '';
}

function renderConnection(email = '') {
  const card = $('connection-card');
  const title = $('connection-title');
  const detail = $('connection-detail');
  const action = $('connection-action');
  card.classList.remove('is-ready', 'is-warning');
  if (state.connected) {
    card.classList.add('is-ready');
    title.textContent = 'DueVinci session ready';
    detail.textContent = email ? `Signed in as ${email}` : 'Signed-in duevinci.tech tab found.';
    action.textContent = 'Refresh';
  } else {
    card.classList.add('is-warning');
    title.textContent = 'DueVinci session needed';
    detail.textContent = 'Keep a signed-in duevinci.tech tab open so imports use your account.';
    action.textContent = 'Connect';
  }
}

function renderReview() {
  const review = $('review');
  const footer = $('footer-actions');
  const list = $('coursework-list');
  list.replaceChildren();
  if (!state.scan) {
    review.classList.add('is-hidden');
    footer.classList.add('is-hidden');
    renderPacingGuidePanel();
    renderCourseWindow();
    renderCourseMetadata();
    return;
  }
  review.classList.remove('is-hidden');
  footer.classList.remove('is-hidden');
  $('source-platform').textContent = prettyPlatform(state.scan.platform).toUpperCase();
  $('course-title').textContent = state.scan.courseTitle;
  $('scan-summary').textContent = `${state.scan.items.length} item${state.scan.items.length === 1 ? '' : 's'} found · Review before importing`;

  state.scan.items.forEach((item, index) => {
    const row = document.createElement('label');
    row.className = 'coursework-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.selected;
    checkbox.addEventListener('change', () => { item.selected = checkbox.checked; refreshSelectionState(); });
    const content = document.createElement('div');
    const title = document.createElement('span');
    title.className = 'item-title';
    title.title = item.title;
    title.textContent = item.kind === 'unit' && item.week ? `Unit ${item.week}: ${item.title}` : item.title;
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const kind = document.createElement('span');
    kind.className = 'item-kind';
    kind.textContent = item.kind;
    const due = document.createElement('span');
    const formattedDate = formatDate(item.dueAt, !item.dueIsEstimated);
    due.className = `item-date ${formattedDate ? '' : 'is-missing'}`;
    due.textContent = formattedDate ? `${item.dueIsEstimated ? 'Target' : 'Due'} ${formattedDate}${item.dueIsEstimated ? ' (estimated)' : ''}` : item.dueText ? item.dueText : 'No due date found';
    meta.append(kind, due);
    content.append(title, meta);
    row.append(checkbox, content);
    row.dataset.index = String(index);
    list.append(row);
  });
  renderPacingGuidePanel();
  renderCourseWindow();
  renderCourseMetadata();
  refreshSelectionState();
}

function refreshSelectionState() {
  const selected = selectedCoursework();
  $('select-all').checked = Boolean(state.scan?.items.length) && selected.length === state.scan.items.length;
  $('select-all').indeterminate = Boolean(selected.length && state.scan && selected.length < state.scan.items.length);
  const importButton = $('import-button');
  importButton.disabled = !selected.length || state.importing || !state.connected;
  importButton.textContent = state.importing ? 'Importing…' : `Import ${selected.length || ''} selected`.replace('  selected', ' selected');
}

async function connectDueVinci() {
  setStatus('Checking for a signed-in DueVinci tab…');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'DUEVINCI_CONNECT' });
    if (!result?.ok) throw new Error(result?.error || 'Could not connect to DueVinci.');
    state.connected = true;
    renderConnection(result.email);
    refreshSelectionState();
    setStatus('DueVinci is ready. Scan your course page when you are ready.', 'success');
  } catch (error) {
    state.connected = false;
    renderConnection();
    setStatus(error instanceof Error ? error.message : 'Could not connect to DueVinci.', 'error');
  }
}

async function scanPage() {
  if (state.scanning) return;
  state.scanning = true;
  const button = $('scan-button');
  button.disabled = true;
  button.querySelector('.button-icon').textContent = '…';
  setStatus('Scanning the course page…');
  try {
    const sourceOverride = $('source-select').value;
    const result = await chrome.runtime.sendMessage({ type: 'DUEVINCI_SCAN_ACTIVE_TAB', sourceOverride });
    if (!result?.ok) throw new Error(result?.error || 'The course page could not be scanned.');
    state.scan = result.scan;
    await clearPendingGuideScan();
    state.scan.items.forEach((item) => { item.selected = state.scan.platform === 'wgu' && state.scan.requiresPacingGuide ? false : true; });
    renderReview();
    if (result.scan.isWguTermPage) {
      const saved = result.scan.scheduleSaved ? ' Saved in the extension.' : result.scan.scheduleStorageAvailable === false ? ' Storage is unavailable; reload the unpacked extension before continuing.' : ' No complete course windows were found to save.';
      setStatus(`${result.scan.termCourses?.length || 0} WGU course date${result.scan.termCourses?.length === 1 ? '' : 's'} captured.${saved} Open a course page to continue.`, result.scan.scheduleSaved ? 'success' : 'error');
    } else if (result.scan.platform === 'wgu' && result.scan.requiresPacingGuide) {
      const scheduleMessage = result.scan.termScheduleMatched ? ' Saved course dates matched.' : ' Scan the WGU term page first to save its course dates.';
      setStatus(`The course page has no direct coursework dates. Choose its downloaded pacing guide DOCX below to create weekly lessons; page assessment links stay unselected.${scheduleMessage}`, result.scan.termScheduleMatched ? 'success' : 'error');
    } else {
      setStatus(result.scan.items.length ? 'Review the detected coursework before it is sent.' : 'No coursework was detected here. Try a page that lists assignments or modules.', result.scan.items.length ? 'success' : 'error');
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'The course page could not be scanned.', 'error');
  } finally {
    state.scanning = false;
    button.disabled = false;
    button.querySelector('.button-icon').textContent = '↻';
  }
}

async function importPacingGuide(file) {
  if (!file || !state.scan) return;
  setStatus('Reading the WGU pacing guide…');
  try {
    state.scan = await DueVinciDocx.parsePacingGuide(file, state.scan);
    if (!state.scan.items.length) throw new Error('The pacing guide was read, but no weekly to-do items were found. Choose the DOCX downloaded from the WGU Connect pacing-guide post.');
    await savePendingGuideScan(state.scan);
    renderReview();
    setStatus(`${state.scan.items.length} pacing-guide item${state.scan.items.length === 1 ? '' : 's'} found. Review before importing.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'The pacing guide could not be read.', 'error');
  }
}

async function importSelected() {
  const coursework = selectedCoursework();
  if (!coursework.length || !state.scan) return;
  if (!state.connected) {
    setStatus('Connect a signed-in DueVinci tab before importing.', 'error');
    return;
  }
  state.importing = true;
  refreshSelectionState();
  setStatus('Sending only the approved coursework to DueVinci…');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'DUEVINCI_IMPORT', scan: state.scan, coursework });
    if (!result?.ok) throw new Error(result?.error || 'DueVinci could not import this coursework.');
    await clearPendingGuideScan();
    const metadataNotice = result.metadataPersisted === false ? ' Apply DueVinci’s weekly-pacing migration to save the course window.' : '';
    setStatus(`${result.imported} item${result.imported === 1 ? '' : 's'} added to ${result.courseName || 'DueVinci'}.${metadataNotice}`, result.metadataPersisted === false ? 'error' : 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'DueVinci could not import this coursework.', 'error');
  } finally {
    state.importing = false;
    refreshSelectionState();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('dismiss-beta-announcement').addEventListener('click', dismissBetaAnnouncement);
  $('connection-action').addEventListener('click', connectDueVinci);
  $('settings-button').addEventListener('click', connectDueVinci);
  $('scan-button').addEventListener('click', scanPage);
  $('source-select').addEventListener('change', () => saveSourcePreference($('source-select').value));
  $('import-button').addEventListener('click', importSelected);
  $('open-guide-button').addEventListener('click', () => {
    if (state.scan?.pacingGuideUrl) chrome.tabs.create({ url: state.scan.pacingGuideUrl });
  });
  $('pacing-file').addEventListener('change', (event) => importPacingGuide(event.target.files?.[0]));
  $('select-all').addEventListener('change', (event) => {
    if (!state.scan) return;
    state.scan.items.forEach((item) => { item.selected = event.target.checked; });
    renderReview();
  });
  loadSourcePreference().then((preferred) => { $('source-select').value = preferred; });
  renderConnection();
  refreshSelectionState();
  renderBetaAnnouncement().catch(() => {});
  restorePendingGuideScan().catch(() => {});
});
