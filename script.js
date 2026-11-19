/* CreeUnity Adventskalender – Vanilla JS, ohne Build-Schritt.
 * Die öffentliche Konfiguration enthält nur bereits veröffentlichte Tagesinhalte.
 * Die tägliche GitHub Action liest die vollständigen Inhalte aus einem privaten Repository.
 */
import { GitHubEditor, detectImage, privateImagePath } from './github-editor.js';
import { renderFormattedText, formatSelection } from './text-format.js';
import { validatePuzzle, puzzleIdentity, checkPuzzleAnswer } from './puzzles.js';
import { CalendarAPI, attemptMessage } from './puzzle-client.js';
import { safeAudioUrl, audioMime, privateAudioPath, detectAudio, MAX_AUDIO_SIZE } from './media.js';

const BERLIN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Datumsteile explizit aus Berlin; unabhängig von der Zeitzone des Endgeräts. */
export function getBerlinDateParts(date = new Date()) {
  return Object.fromEntries(BERLIN.formatToParts(date)
    .filter(({ type }) => ['year', 'month', 'day'].includes(type))
    .map(({ type, value }) => [type, Number(value)]));
}

/** Nach dem Kalenderjahr bleiben vergangene Türchen ebenfalls zugänglich. */
export function isDoorUnlocked(day, year, date = new Date(), releaseMonth = 12) {
  if (!Number.isInteger(day) || day < 1 || day > 24) return false;
  if (![11, 12].includes(releaseMonth)) return false;
  const berlin = getBerlinDateParts(date);
  return berlin.year > year || (berlin.year === year && (berlin.month > releaseMonth || (berlin.month === releaseMonth && berlin.day >= day)));
}

export function isConfigDoorUnlocked(day, config, date = new Date()) { return isDoorUnlocked(day, config.year, date, config.releaseMonth ?? 12); }

/** Gemischt, aber pro Kalenderjahr stabil: kein Springen bei Refresh oder Datumswechsel. */
export function getDoorOrder(year) {
  const days = Array.from({ length: 24 }, (_, index) => index + 1);
  let seed = year >>> 0;
  for (let i = days.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [days[i], days[j]] = [days[j], days[i]];
  }
  return days;
}

/** Nur HTTP(S) und relative Bildpfade. data:, javascript: und HTML werden abgewiesen. */
export function safeUrl(value, { image = false, base = 'https://example.invalid/calendar/' } = {}) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  if (!image && !/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    // Verhindert Mixed Content auf GitHub Pages; localhost bleibt zum Entwickeln nutzbar.
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return '';
    return image ? raw : url.href;
  } catch { return ''; }
}

/** Strenge Prüfung beim Laden/Importieren; kein unvollständiger Kalender im Export. */
export function validateConfig(input) {
  if (!input || input.version !== 1 || !Number.isInteger(input.year) || input.year < 2024 || input.year > 2100) {
    throw new Error('Bitte verwende Version 1 und ein Kalenderjahr zwischen 2024 und 2100.');
  }
  if (input.releaseMonth !== undefined && ![11, 12].includes(input.releaseMonth)) throw new Error('Freigabemonat muss November (11) oder Dezember (12) sein.');
  if (!Array.isArray(input.doors) || input.doors.length !== 24) throw new Error('Die JSON-Datei muss genau 24 Türchen enthalten.');
  const days = new Set();
  const doors = input.doors.map(door => {
    if (!door || !Number.isInteger(door.day) || door.day < 1 || door.day > 24 || days.has(door.day)) {
      throw new Error('Jede Türchennummer von 1 bis 24 muss genau einmal vorkommen.');
    }
    days.add(door.day);
    if (typeof door.title !== 'string' || !door.title.trim() || door.title.length > 200) throw new Error(`Türchen ${door.day}: Bitte eine Überschrift mit maximal 200 Zeichen eingeben.`);
    if (!safeUrl(door.image, { image: true })) throw new Error(`Türchen ${door.day}: Bitte einen relativen Bildpfad oder eine HTTPS-Bild-URL eingeben.`);
    if (typeof door.text !== 'string' || door.text.length > 10000) throw new Error(`Türchen ${door.day}: Der Text darf maximal 10.000 Zeichen enthalten.`);
    if (door.alt != null && (typeof door.alt !== 'string' || door.alt.length > 500)) throw new Error(`Türchen ${door.day}: Die Bildbeschreibung darf maximal 500 Zeichen enthalten.`);
    if (door.audio != null && door.audio !== '' && !safeAudioUrl(door.audio)) throw new Error(`Türchen ${door.day}: Bitte einen Audio-Pfad oder eine HTTPS-Audio-URL für MP3, WAV, M4A oder Ogg eingeben.`);
    if (input.releaseMode === 'daily' && typeof door.released !== 'boolean') throw new Error(`Türchen ${door.day}: Die Veröffentlichungsangabe fehlt.`);
    let puzzle;
    try { puzzle = validatePuzzle(door.puzzle); } catch (error) { throw new Error(`Türchen ${door.day}: ${error.message}`); }
    return { day: door.day, title: door.title.trim(), image: door.image.trim(), alt: door.alt || '', text: door.text,
      ...(door.audio ? { audio: door.audio.trim() } : {}),
      ...(puzzle ? { puzzle } : {}),
      ...(input.releaseMode === 'daily' ? { released: door.released } : {}) };
  }).sort((a, b) => a.day - b.day);
  const links = input.links || {};
  for (const name of ['twitch', 'discord']) {
    if (links[name] && !safeUrl(links[name])) throw new Error(`Bitte eine gültige HTTPS-URL für ${name} eingeben.`);
  }
  return { version: 1, year: input.year, links: { twitch: links.twitch || '', discord: links.discord || '' },
    ...(input.releaseMonth !== undefined ? { releaseMonth: input.releaseMonth } : {}),
    ...(input.releaseMode === 'daily' ? { releaseMode: 'daily' } : {}), doors };
}

// Der DOM-Teil wird beim Import durch Node-Tests nicht ausgeführt.
if (typeof document !== 'undefined') initialize();

function initialize() {
  const $ = id => document.getElementById(id);
  const adminAccess = new URLSearchParams(location.search).get('admin') === 'true';
  // Designvorschau lädt ausschließlich öffentliche Inhalte und benötigt keinen Zugangsschlüssel.
  const puzzleDemo = new URLSearchParams(location.search).get('preview') === 'puzzle';
  const designPreview = puzzleDemo || new URLSearchParams(location.search).get('preview') === 'design';
  const DRAFT_KEY = 'creeunity:admin-draft:v1';
  const PREVIEW_KEY = 'creeunity:preview:v1';
  const TAB_ACCESS_KEY = 'creeunity:github-access:tab:v1';
  const state = { config: null, editor: null, published: null, opened: new Set(), previewOpened: new Set(), solved: {}, previewSolved: {}, selectedDay: 1, preview: false, storageOK: true, zoom: 1, activeDay: null };
  let lastRender = '';
  let toastTimeout;
  let resetArmed = false;
  let refreshing = false;
  let refreshTime = 0;
  let repository = null;
  let editorCredential = '';
  let githubBusy = false;
  let doorRequest = 0;
  let privateImageGeneration = 0;
  const pendingImages = new Map();
  const privatePreviews = new Map();
  const privateImageLoads = new Map();
  const pendingAudio = new Map();
  const privateAudioPreviews = new Map();
  const privateAudioLoads = new Map();
  let audioRequest = 0;
  let editorAudioRequest = 0;
  const participantAPI = new CalendarAPI();
  let participant = { loading: true, available: false, authEnabled: false, user: null, error: '' };
  let serverStatuses = {};
  let serverClock = { time: Date.now(), received: performance.now() };
  let participantRequest = 0;
  let puzzleBusy = false;
  let deleteAccountArmed = false;
  let openedQueue = Promise.resolve();
  let openedWrites = 0;
  let openedEpoch = 0;
  let accountEpoch = 0;
  const serverNow = () => serverClock.time + performance.now() - serverClock.received;
  const releaseMonthName = () => state.config.releaseMonth === 11 ? 'November' : 'Dezember';
  const isCalendarDayUnlocked = (day, date = new Date()) => isConfigDoorUnlocked(day, state.config, date);
  function syncServerClock(value) {
    if (Number.isFinite(value)) serverClock = { time: value, received: performance.now() };
  }
  function renderParticipant() {
    $('participant-access').hidden = state.preview;
    $('participant-login').hidden = participant.loading || !participant.available || !participant.authEnabled || !!participant.user;
    $('participant-logout').hidden = !participant.user;
    $('participant-retry').hidden = !participant.error;
    $('participant-data-controls').hidden = !participant.user || state.preview;
    $('participant-status').textContent = participant.loading ? 'Discord-Anmeldung wird geladen …'
      : participant.closed ? 'Die Teilnahme ist beendet. Die gespeicherten Teilnehmerdaten wurden gelöscht.'
      : participant.error || (participant.user ? 'Mit Discord angemeldet.'
      : participant.authEnabled ? 'Melde dich mit Discord an, um Lösungen zu prüfen und deine Sammlung zu speichern.'
      : 'Die Discord-Anmeldung wird noch eingerichtet.');
  }
  async function refreshParticipant() {
    if (!state.config || state.preview || puzzleBusy || openedWrites) return;
    const request = ++participantRequest;
    const openedAtRequest = openedEpoch;
    const previouslySignedIn = !!participant.user;
    const previouslySolved = !!state.solved[state.activeDay];
    try {
      const session = await participantAPI.session();
      const progress = session.user ? await participantAPI.statuses() : null;
      if (request !== participantRequest || state.preview) return;
      participant = { ...session, loading: false, available: true, error: '' };
      syncServerClock(progress?.serverNow ?? session.serverNow);
      serverStatuses = {};
      state.solved = {};
      if (openedAtRequest === openedEpoch && !openedWrites) {
        if (session.user) state.opened = new Set(progress?.year === state.config.year ? progress.opened || [] : []);
        else readGuestOpened();
      }
      if (progress?.year === state.config.year) {
        for (const status of progress.puzzles) {
          serverStatuses[status.day] = status;
          const door = state.config.doors.find(item => item.day === status.day);
          if (status.solved && door?.puzzle) state.solved[status.day] = { identity: puzzleIdentity(door.puzzle), fragment: status.fragment || '' };
        }
      }
    } catch {
      if (request !== participantRequest) return;
      participant = { loading: false, available: false, authEnabled: false, user: null, error: 'Die Anmeldung und Lösungsprüfung sind gerade nicht verfügbar. Bitte versuche es später noch einmal.' };
      serverStatuses = {}; state.solved = {};
      readGuestOpened();
    }
    renderParticipant(); renderCalendar();
    if ($('door-modal').open) {
      if (previouslySignedIn !== !!participant.user || previouslySolved !== !!state.solved[state.activeDay]) renderActivePuzzle();
      else renderAttemptState();
    }
  }
  $('participant-retry').addEventListener('click', refreshParticipant);
  function persistOpened(year, day) {
    const account = accountEpoch;
    let failed = false;
    ++openedEpoch; ++openedWrites;
    openedQueue = openedQueue.then(async () => {
      if (account !== accountEpoch || !participant.user) return;
      const progress = await participantAPI.openDoor(year, day);
      if (account === accountEpoch && openedWrites === 1 && progress.year === state.config.year) {
        state.opened = new Set(progress.opened);
        renderCalendar();
      }
    }).catch(() => {
      failed = true;
      if (account === accountEpoch) toast('Dieses Türchen konnte gerade nicht im Konto gespeichert werden. Bitte öffne es später erneut.');
    }).finally(() => {
      --openedWrites;
      if (failed && !openedWrites && account === accountEpoch) refreshParticipant();
    });
  }
  $('participant-logout').addEventListener('click', async () => {
    ++participantRequest;
    ++accountEpoch; ++openedEpoch;
    $('participant-logout').disabled = true;
    try {
      await participantAPI.logout();
      state.solved = {}; serverStatuses = {};
      participant.user = null;
      readGuestOpened();
      renderParticipant(); renderCalendar(); renderActivePuzzle();
      toast('Abgemeldet. Deine Sammlung und laufende Rätselpausen bleiben in deinem Konto erhalten.');
    } catch { toast('Abmelden ist gerade nicht möglich. Bitte versuche es erneut.'); }
    finally { $('participant-logout').disabled = false; }
  });
  $('export-account').addEventListener('click', async () => {
    $('export-account').disabled = true;
    try {
      const data = await participantAPI.exportAccount();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'creeunity-meine-daten.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('account-feedback').textContent = 'Deine gespeicherten Kalenderdaten wurden als Datei bereitgestellt.';
    } catch { $('account-feedback').textContent = 'Die Auskunft ist gerade nicht verfügbar. Bitte versuche es erneut.'; }
    finally { $('export-account').disabled = false; }
  });
  $('delete-account').addEventListener('click', async () => {
    if (!deleteAccountArmed) {
      deleteAccountArmed = true;
      $('delete-account').textContent = 'Ja, meine Kalenderdaten endgültig löschen';
      $('account-feedback').textContent = 'Damit werden dein gesamter Kontofortschritt einschließlich geöffneter Türchen und alle deine Sitzungen gelöscht. Lokale Gastöffnungen in diesem Browser werden ebenfalls zurückgesetzt. Klicke zur Bestätigung noch einmal.';
      return;
    }
    $('delete-account').disabled = true;
    ++participantRequest;
    ++accountEpoch; ++openedEpoch;
    try {
      await participantAPI.deleteAccount();
      participant.user = null; state.solved = {}; serverStatuses = {}; state.opened.clear();
      writeStorage(progressKey(), null); writeStorage(solvedKey(), null);
      renderParticipant(); renderCalendar(); renderActivePuzzle();
      $('account-feedback').textContent = 'Deine Kalenderdaten und alle Anmeldesitzungen wurden gelöscht.';
    } catch { $('account-feedback').textContent = 'Die Löschung ist gerade nicht verfügbar. Bitte versuche es erneut.'; }
    finally { deleteAccountArmed = false; $('delete-account').disabled = false; $('delete-account').textContent = 'Meine Kalenderdaten löschen'; }
  });

  function clearPrivateImages() {
    resetDoorAudio();
    resetEditorAudio();
    privateImageGeneration++;
    for (const item of pendingImages.values()) URL.revokeObjectURL(item.url);
    for (const url of privatePreviews.values()) URL.revokeObjectURL(url);
    pendingImages.clear(); privatePreviews.clear(); privateImageLoads.clear();
    for (const item of pendingAudio.values()) URL.revokeObjectURL(item.url);
    for (const url of privateAudioPreviews.values()) URL.revokeObjectURL(url);
    pendingAudio.clear(); privateAudioPreviews.clear(); privateAudioLoads.clear();
    lastRender = '';
  }
  function githubStatus(message) { $('github-status').textContent = message; }
  function setGitHubBusy(value) {
    githubBusy = value;
    $('github-connect').disabled = value;
    $('github-reload').disabled = value;
    $('github-disconnect').disabled = value;
    $('github-token').disabled = value;
    $('github-remember').disabled = value;
    $('admin-form').querySelectorAll('button,input,textarea,select').forEach(el => { el.disabled = value; });
    $('github-save').disabled = value || !repository;
  }
  async function resolveDoorImage(door) {
    const pending = pendingImages.get(door.day);
    if (pending?.path === door.image) return pending.url;
    if (!repository || !/^(\.\/)?images\//.test(door.image)) return door.image;
    const path = privateImagePath(door.image);
    if (privatePreviews.has(path)) return privatePreviews.get(path);
    if (privateImageLoads.has(path)) return privateImageLoads.get(path);
    const activeRepository = repository;
    const generation = privateImageGeneration;
    const loading = (async () => {
      const blob = await activeRepository.image(path);
      if (repository !== activeRepository || generation !== privateImageGeneration) throw new Error('Die Bildvorschau wurde neu geladen oder die Verbindung beendet.');
      const extension = path.split('.').pop().toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' }[extension];
      if (!mime) throw new Error('Dieses Bildformat kann nicht angezeigt werden.');
      const url = URL.createObjectURL(new Blob([blob], { type: mime }));
      privatePreviews.set(path, url);
      return url;
    })();
    privateImageLoads.set(path, loading);
    try { return await loading; }
    finally { if (privateImageLoads.get(path) === loading) privateImageLoads.delete(path); }
  }

  /** Nur geöffnete, zugängliche Türchen laden Bilder; bei Fehlern bleibt das Weihnachtsmotiv. */
  async function renderDoorThumbnail(door, reveal, canShowImage) {
    const fallback = document.createElement('span'); fallback.className = 'door-thumbnail-fallback';
    reveal.append(fallback);
    const path = safeUrl(door.image, { image: true });
    if (!canShowImage || !path || new URL(path, location.href).pathname === new URL('./assets/placeholder.svg', location.href).pathname) return;
    const image = document.createElement('img');
    image.className = 'door-thumbnail'; image.alt = ''; image.decoding = 'async'; image.hidden = true;
    image.addEventListener('load', () => { image.hidden = false; fallback.hidden = true; });
    image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; });
    reveal.append(image);
    try {
      const source = await resolveDoorImage(door);
      // Beim Abmelden, Zurücksetzen oder Wechseln des Tages kann dieses Raster bereits ersetzt sein.
      if (reveal.isConnected && source) image.src = source;
    } catch { /* Auch private oder nicht mehr verfügbare Bilder fallen auf das Weihnachtsmotiv zurück. */ }
  }
  async function updateEditorImage() {
    if (!state.editor) return;
    const day = state.selectedDay;
    const image = $('admin-door-image').value.trim();
    $('admin-image-preview').hidden = true;
    try {
      const url = await resolveDoorImage({ day, image });
      if (state.selectedDay !== day || $('admin-door-image').value.trim() !== image) return;
      $('admin-image-preview').src = url;
      $('admin-image-preview').hidden = false;
    } catch { /* Die Türchen-Vorschau zeigt bei Bedarf den ausführlichen Bildhinweis. */ }
  }

  async function resolveDoorAudio(door) {
    if (!door.audio) return '';
    const pending = pendingAudio.get(door.day);
    if (pending?.path === door.audio) return pending.url;
    if (!repository || !/^(\.\/)?audio\//.test(door.audio)) return safeAudioUrl(door.audio);
    const path = privateAudioPath(door.audio);
    if (privateAudioPreviews.has(path)) return privateAudioPreviews.get(path);
    if (privateAudioLoads.has(path)) return privateAudioLoads.get(path);
    const activeRepository = repository, generation = privateImageGeneration;
    const loading = (async () => {
      const blob = await activeRepository.audio(path);
      if (repository !== activeRepository || generation !== privateImageGeneration) throw new Error('Die Audiovorschau wurde beendet.');
      const url = URL.createObjectURL(new Blob([blob], { type: audioMime(path) }));
      privateAudioPreviews.set(path, url);
      return url;
    })();
    privateAudioLoads.set(path, loading);
    try { return await loading; }
    finally { if (privateAudioLoads.get(path) === loading) privateAudioLoads.delete(path); }
  }
  function resetPlayer(player) { player.pause(); player.removeAttribute('src'); player.load(); }
  function resetDoorAudio() {
    ++audioRequest;
    resetPlayer($('door-audio'));
    $('door-audio-section').hidden = true;
    $('audio-error').hidden = true;
    $('audio-download').removeAttribute('href');
  }
  function resetEditorAudio() { ++editorAudioRequest; resetPlayer($('admin-audio-preview')); $('admin-audio-preview').hidden = true; }
  async function renderDoorAudio(door) {
    resetDoorAudio();
    if (!door.audio) return;
    const request = audioRequest;
    $('door-audio-section').hidden = false;
    try {
      const url = await resolveDoorAudio(door);
      if (request !== audioRequest || !$('door-modal').open) return;
      $('door-audio').src = url;
      $('audio-download').href = url;
    } catch { if (request === audioRequest) $('audio-error').hidden = false; }
  }
  async function updateEditorAudio() {
    resetEditorAudio();
    const request = editorAudioRequest;
    if (!state.editor) return;
    const day = state.selectedDay, audio = $('admin-door-audio').value.trim();
    if (!audio) return;
    try {
      const url = await resolveDoorAudio({ day, audio });
      if (request !== editorAudioRequest || state.selectedDay !== day || $('admin-door-audio').value.trim() !== audio || !url) return;
      $('admin-audio-preview').src = url;
      $('admin-audio-preview').hidden = false;
    } catch { /* Der Türchenplayer zeigt bei Bedarf den Ladehinweis. */ }
  }
  $('door-audio').addEventListener('error', () => { if ($('door-audio').hasAttribute('src')) $('audio-error').hidden = false; });
  $('door-modal').addEventListener('close', () => { if (!$('door-modal').open) resetDoorAudio(); });
  $('admin-modal').addEventListener('close', () => { if (!$('admin-modal').open) resetEditorAudio(); });
  $('door-audio').addEventListener('play', () => $('admin-audio-preview').pause());
  $('admin-audio-preview').addEventListener('play', () => $('door-audio').pause());

  // Speicher ist optional: Privatmodus/volle Quota dürfen den Kalender nicht lahmlegen.
  function readStorage(key, session = false) {
    try { return (session ? sessionStorage : localStorage).getItem(key); }
    catch { state.storageOK = false; return null; }
  }
  function writeStorage(key, value, session = false) {
    try {
      const storage = session ? sessionStorage : localStorage;
      value === null ? storage.removeItem(key) : storage.setItem(key, value);
      return true;
    } catch { state.storageOK = false; return false; }
  }
  function toast(message) {
    clearTimeout(toastTimeout);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 6500);
  }
  function feedback(message) { $('admin-feedback').textContent = message; }
  const progressKey = () => state.config.releaseMonth === 11 ? `creeunity:test-opened:${state.config.year}:11` : `creeunity:opened:${state.config.year}`;
  const solvedKey = () => `creeunity:solved:${state.config.year}`;
  // Testfortschritt bleibt bei F5 erhalten, überschreibt aber nie echte Öffnungen/Lösungen.
  const previewProgressKey = () => `creeunity:preview-progress:v1:${puzzleDemo ? 'puzzle' : designPreview ? 'design' : 'editor'}:${state.config.year}`;

  function savedSolutions(saved) {
    const solutions = {};
    for (let day = 1; day <= 24; day++) {
      const record = saved?.[day];
      if (record && typeof record.identity === 'string' && record.identity.length <= 1000 && typeof record.fragment === 'string' && record.fragment.length <= 120) solutions[day] = { identity: record.identity, fragment: record.fragment };
    }
    return solutions;
  }

  function savePreviewProgress() {
    if (!state.preview || !state.config) return false;
    return writeStorage(previewProgressKey(), JSON.stringify({ opened: [...state.previewOpened], solved: state.previewSolved, selectedDay: state.selectedDay }), true);
  }

  function restorePreviewProgress() {
    try {
      const saved = JSON.parse(readStorage(previewProgressKey(), true) || 'null');
      if (!saved || !Array.isArray(saved.opened)) return false;
      state.previewOpened = new Set(saved.opened.filter(day => Number.isInteger(day) && day >= 1 && day <= 24));
      state.previewSolved = savedSolutions(saved.solved);
      state.selectedDay = Number.isInteger(saved.selectedDay) && saved.selectedDay >= 1 && saved.selectedDay <= 24 ? saved.selectedDay : 1;
      return true;
    } catch { return false; }
  }

  function forgetEditorTabState() {
    writeStorage(TAB_ACCESS_KEY, null, true);
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('creeunity:preview-progress:v1:editor:')) sessionStorage.removeItem(key);
      }
    } catch { state.storageOK = false; }
  }

  function readGuestOpened() {
    try {
      const saved = JSON.parse(readStorage(progressKey()) || '[]');
      state.opened = new Set(Array.isArray(saved) ? saved.filter(n => Number.isInteger(n) && n >= 1 && n <= 24) : []);
    } catch { state.opened = new Set(); }
  }
  function readProgress() {
    readGuestOpened();
    // Solved production puzzles are restored exclusively from the server.
    // Local editing/resetting cannot grant rewards or reset a lockout.
    state.solved = {};
  }

  async function loadConfiguration() {
    $('retry-load').disabled = true;
    try {
      const response = await fetch('./doors-data.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`doors-data.json konnte nicht geladen werden (HTTP ${response.status}).`);
      state.published = validateConfig(await response.json());
      state.config = structuredClone(state.published);
      if (adminAccess && !designPreview) {
        const draft = readStorage(DRAFT_KEY);
        if (draft) {
          try { state.config = validateConfig(JSON.parse(draft)); feedback('Dein lokaler Entwurf wurde geladen.'); }
          catch { feedback('Der lokale Entwurf war ungültig. Die veröffentlichten Daten wurden geladen.'); }
        }
        state.preview = readStorage(PREVIEW_KEY, true) === 'true';
      }
      if (designPreview) {
        state.preview = true;
        state.previewOpened = new Set([1, 5, 12]);
      }
      if (puzzleDemo) {
        // Ausschließlich erfundene Beispielrätsel; niemals echte zukünftige Inhalte ergänzen.
        Object.assign(state.config.doors[0], { title: 'Beispielrätsel · Türchen 1', image: './assets/door-surprise.svg', text: 'DEMO: Wie viele Türchen hat dieser Adventskalender? Gib die Zahl ein.', puzzle: { type: 'number', answer: '24', fragment: 'FRO' } });
        Object.assign(state.config.doors[4], { title: 'Beispielrätsel · Türchen 5', image: './assets/emotes/piepLove.png', text: 'DEMO: Die heutige Buchstabenfolge lautet HE. Teste unten die Prüfung.', puzzle: { type: 'letters', answer: 'HE' } });
      }
      if (state.preview) { restorePreviewProgress(); savePreviewProgress(); }
      readProgress();
      if (!state.preview) await refreshParticipant();
      renderParticipant();
      updateLinks();
      renderCalendar();
      $('load-error').hidden = true;
      if (adminAccess) {
        populateAdmin();
        if (!designPreview) {
          $('admin-modal').showModal();
          if (readStorage(TAB_ACCESS_KEY, true)) {
            $('github-remember').checked = true;
            await connectRepository(false, true);
          }
        }
      }
    } catch (error) {
      $('load-error').hidden = false;
      $('calendar-status').textContent = 'Kalender gerade nicht verfügbar';
      $('doors-grid').replaceChildren();
      $('load-error-text').textContent = location.protocol === 'file:'
        ? 'Bitte öffne das Projekt über einen lokalen Webserver (node tools/serve.mjs) oder GitHub Pages. Ein Doppelklick auf index.html kann die JSON-Datei nicht laden.'
        : `${error.message} Bitte prüfe die Konfiguration und lade die Seite erneut.`;
    } finally {
      $('doors-grid').setAttribute('aria-busy', 'false');
      $('retry-load').disabled = false;
    }
  }

  function updateLinks() {
    for (const name of ['twitch', 'discord']) {
      const link = $(`${name}-link`);
      const url = safeUrl(state.config.links[name]);
      link.hidden = !url;
      if (url) link.href = url;
      else link.removeAttribute('href');
    }
    $('calendar-year').textContent = state.config.year;
    $('calendar-month').textContent = releaseMonthName();
    $('release-help').textContent = `Ab dem 1. ${releaseMonthName()}, nach der täglichen Freigabe.`;
    $('release-info-title').textContent = state.config.releaseMonth === 11 ? 'Öffentlicher November-Test' : 'Ein Dezember voller CreeUnity';
    $('release-info').textContent = `Jedes Türchen erscheint frühestens am jeweiligen ${releaseMonthName()}tag nach Berliner Zeit. Frühere Türchen bleiben erreichbar.`;
    $('footer-year').textContent = state.config.year;
    document.title = `CreeUnity Adventskalender · ${state.config.year}`;
  }

  function solvedPuzzles() {
    const records = state.preview ? state.previewSolved : state.solved;
    return state.config.doors.filter(door => door.puzzle && (state.preview || (isCalendarDayUnlocked(door.day) && door.released !== false)) && records[door.day]?.identity === puzzleIdentity(door.puzzle));
  }

  function renderPuzzleCollection(solved) {
    const enabled = state.config.doors.some(door => door.puzzle && (state.preview || (isCalendarDayUnlocked(door.day) && door.released !== false)));
    $('puzzle-collection').hidden = !enabled;
    $('solved-progress').textContent = `${state.preview ? 'Vorschau: ' : ''}${solved.length} von 24 Rätseln gelöst`;
    const records = state.preview ? state.previewSolved : state.solved;
    $('puzzle-fragments').replaceChildren();
    for (let day = 1; day <= 24; day++) {
      const item = document.createElement('div');
      const done = solved.some(door => door.day === day);
      item.className = `puzzle-fragment${done ? ' is-collected' : ''}`;
      const label = document.createElement('span'); label.textContent = String(day);
      const fragment = document.createElement('strong'); fragment.textContent = done ? records[day].fragment : '…';
      item.append(label, fragment); $('puzzle-fragments').append(item);
    }
  }

  function renderCalendar() {
    if (!state.config) return;
    const { year } = state.config;
    const now = new Date();
    const berlin = getBerlinDateParts(now);
    const releaseMonth = state.config.releaseMonth ?? 12;
    const december = berlin.year === year && berlin.month === releaseMonth;
    // Kein sekündlicher DOM-Austausch: Tastaturfokus und Screenreader bleiben stabil.
    const visibleOpened = state.preview ? state.previewOpened : state.opened;
    const solved = solvedPuzzles();
    const signature = JSON.stringify([year, releaseMonth, berlin, state.preview, [...visibleOpened], solved.map(d => d.day), state.config.doors.map(d => [d.released, d.image, puzzleIdentity(d.puzzle)])]);
    if (signature === lastRender) return;
    lastRender = signature;
    $('calendar-status').textContent = state.preview ? 'Die CreeUnity-Werkstatt ist geöffnet'
      : berlin.year < year || (berlin.year === year && berlin.month < releaseMonth) ? `Die Vorfreude beginnt · ab 1. ${releaseMonthName()} ${year}`
      : december && berlin.day <= 24 ? `${berlin.day}. ${releaseMonthName()} · ${releaseMonth === 11 ? 'Öffentlicher Testlauf' : 'Dein Wintermoment wartet'}`
      : '24 Türchen voller CreeUnity-Momente';
    const fragment = document.createDocumentFragment();
    for (const day of getDoorOrder(year)) {
      const door = state.config.doors.find(item => item.day === day);
      const opened = visibleOpened.has(door.day);
      const unlocked = isCalendarDayUnlocked(door.day, now) && door.released !== false;
      const today = december && berlin.day === door.day;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `door${opened ? ' is-opened' : ''}${today ? ' is-today' : ''}${door.day === 24 ? ' is-finale' : ''}`;
      button.dataset.day = door.day;
      const isSolved = solved.some(item => item.day === door.day);
      button.setAttribute('aria-label', `Türchen ${door.day}${opened ? ', bereits geöffnet' : ''}${isSolved ? ', Rätsel gelöst' : ''}${today ? ', heute' : ''}${!unlocked && !state.preview ? `, öffnet am ${door.day}. ${releaseMonthName()} ${year}` : ''}`);
      // Gesperrte Türchen bleiben bedienbar, damit die freundliche Nachricht erreichbar ist.
      const ornament = document.createElement('span');
      ornament.className = 'door-decoration'; ornament.setAttribute('aria-hidden', 'true');
      ornament.textContent = door.day === 24 ? '✦' : ['✧', '❄', '✦', '✧'][door.day % 4];
      const number = document.createElement('span'); number.className = 'door-number'; number.textContent = door.day;
      const mark = document.createElement('span'); mark.className = 'door-mark'; mark.setAttribute('aria-hidden', 'true');
      mark.textContent = opened ? '✓' : unlocked || state.preview ? '✧' : '⌑';
      // Das Türblatt klappt seitlich auf; dahinter erscheint die jeweilige Tagesgrafik.
      const leaf = document.createElement('span'); leaf.className = 'door-leaf'; leaf.setAttribute('aria-hidden', 'true');
      leaf.append(ornament, number, mark);
      const reveal = document.createElement('span'); reveal.className = 'door-reveal'; reveal.setAttribute('aria-hidden', 'true');
      if (opened) renderDoorThumbnail(door, reveal, state.preview || unlocked);
      button.append(reveal, leaf);
      if (isSolved) { const badge = document.createElement('span'); badge.className = 'door-solved'; badge.textContent = '✓'; badge.setAttribute('aria-hidden', 'true'); button.append(badge); }
      if (today) { const tag = document.createElement('span'); tag.className = 'today-tag'; tag.textContent = 'HEUTE'; button.append(tag); }
      fragment.append(button);
    }
    $('doors-grid').replaceChildren(fragment);
    $('progress-text').textContent = `${state.preview ? 'Vorschau: ' : ''}${visibleOpened.size} von 24 geöffnet`;
    $('calendar-progress').value = visibleOpened.size;
    $('calendar-progress').textContent = `${visibleOpened.size} von 24`;
    $('preview-banner').hidden = !state.preview;
    renderPuzzleCollection(solved);
    $('preview-title').textContent = puzzleDemo ? 'Rätsel-Demo' : designPreview ? 'Designvorschau' : 'Vorschaumodus';
    $('preview-note').textContent = puzzleDemo ? 'Erfundene Beispiele: Türchen 1 → Zahl 24, Türchen 5 → Buchstaben HE. Dein Testfortschritt bleibt bei F5 in diesem Tab erhalten.' : designPreview
      ? 'Beispielöffnungen zum Vergleichen. Zukünftige Inhalte bleiben Platzhalter. Dein echter Fortschritt bleibt unverändert.'
      : 'Öffne und schließe ein Türchen, um seinen geöffneten Zustand zu sehen. Dein echter Fortschritt bleibt unverändert.';
    $('reset-preview').textContent = visibleOpened.size ? 'Vorschau zurücksetzen' : 'Beispielöffnungen zeigen';
  }

  function renderActivePuzzle() {
    const door = state.config.doors.find(item => item.day === state.activeDay);
    const available = door && (state.preview || (isCalendarDayUnlocked(door.day) && door.released !== false));
    $('door-puzzle').hidden = !available || !door.puzzle;
    $('puzzle-answer').value = '';
    $('puzzle-answer').removeAttribute('aria-invalid');
    $('puzzle-feedback').textContent = '';
    $('puzzle-feedback').className = 'puzzle-feedback';
    $('puzzle-login').hidden = true;
    $('puzzle-attempts').textContent = '';
    if (!available || !door.puzzle) return;
    const number = door.puzzle.type === 'number';
    $('puzzle-answer-label').textContent = number ? 'Deine Zahl' : 'Deine Buchstabenfolge';
    $('puzzle-answer').inputMode = number ? 'decimal' : 'text';
    $('puzzle-answer').placeholder = number ? 'Zahl eingeben' : 'Buchstaben eingeben';
    const done = solvedPuzzles().some(item => item.day === door.day);
    $('puzzle-form').hidden = done;
    if (done) {
      const record = (state.preview ? state.previewSolved : state.solved)[door.day];
      $('puzzle-feedback').textContent = number ? `✓ Richtig! Die heutige Buchstabenfolge ist ${record.fragment}` : '✓ Richtig!';
      $('puzzle-feedback').classList.add('is-correct');
    }
    renderAttemptState();
  }

  function renderAttemptState() {
    const door = state.config?.doors.find(item => item.day === state.activeDay);
    if (!door?.puzzle || $('door-puzzle').hidden) return;
    const done = solvedPuzzles().some(item => item.day === door.day);
    if (state.preview) {
      $('puzzle-check').disabled = puzzleBusy || !!door.puzzle.serverOnly;
      $('puzzle-answer').disabled = !!door.puzzle.serverOnly;
      $('puzzle-attempts').textContent = done ? '' : door.puzzle.serverOnly ? 'Lade zum Testen dieses Rätsels den privaten Kalender im Editor.' : 'Vorschau: Testeingaben verändern keine echten Versuche.';
      return;
    }
    const ready = participant.available && !participant.loading && !!participant.user;
    const status = serverStatuses[door.day];
    const locked = (status?.lockedUntil || 0) > serverNow();
    $('puzzle-form').hidden = done || !ready;
    $('puzzle-login').hidden = done || ready;
    $('puzzle-login-link').hidden = !participant.available || !participant.authEnabled || participant.loading;
    $('puzzle-login-note').textContent = participant.loading ? 'Anmeldung wird geladen …' : participant.closed ? 'Die Teilnahme ist beendet. Die Teilnehmerdaten wurden gelöscht.' : participant.error
      || (participant.authEnabled ? 'Zum Prüfen deiner Lösung bitte mit Discord anmelden.' : 'Die Discord-Anmeldung wird noch eingerichtet.');
    $('puzzle-check').disabled = !ready || puzzleBusy || locked || !status;
    $('puzzle-answer').disabled = !ready || locked || !status;
    $('puzzle-attempts').textContent = done || !ready ? '' : attemptMessage(status, serverNow());
  }

  $('puzzle-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('puzzle-check').disabled) return;
    const day = state.activeDay;
    const door = state.config.doors.find(item => item.day === day);
    if (!door?.puzzle || (!state.preview && (!isCalendarDayUnlocked(day) || door.released === false))) return;
    const year = state.config.year;
    const preview = state.preview;
    const identity = puzzleIdentity(door.puzzle);
    ++participantRequest; // Invalidate any in-flight background status request.
    const answerRequest = participantRequest;
    puzzleBusy = true;
    $('puzzle-check').disabled = true;
    try {
      const result = preview ? await checkPuzzleAnswer(door.puzzle, $('puzzle-answer').value, year, day)
        : await participantAPI.answer(year, day, $('puzzle-answer').value);
      if (participantRequest !== answerRequest || state.config.year !== year || state.preview !== preview || puzzleIdentity(state.config.doors.find(item => item.day === day)?.puzzle) !== identity) return;
      if (!preview) { serverStatuses[day] = result; syncServerClock(result.serverNow); }
      if (!result.correct) {
        if (state.activeDay === day) {
          $('puzzle-feedback').textContent = result.lockedUntil ? '10 Fehlversuche erreicht. Bitte warte, bis die Rätselpause vorbei ist.' : 'Noch nicht ganz – versuch es noch einmal.';
          $('puzzle-answer').setAttribute('aria-invalid', 'true');
        }
        return;
      }
      const records = preview ? state.previewSolved : state.solved;
      records[day] = { identity, fragment: result.fragment };
      const stored = preview ? savePreviewProgress() : true;
      renderCalendar();
      if (state.activeDay === day) renderActivePuzzle();
      if (!stored && state.activeDay === day) $('puzzle-feedback').textContent += ' Für diesen Besuch gemerkt; dein Browser blockiert die Speicherung.';
    } catch (error) {
      if (participantRequest === answerRequest && state.activeDay === day) $('puzzle-feedback').textContent = error.status ? error.message : 'Die Prüfung ist gerade nicht verfügbar. Bitte lade deinen Versuchsstand neu, bevor du es erneut probierst.';
      if (error.status === 401) { participant.user = null; state.solved = {}; serverStatuses = {}; renderParticipant(); renderCalendar(); }
    } finally { puzzleBusy = false; renderAttemptState(); }
  });
  $('puzzle-answer').addEventListener('input', () => $('puzzle-answer').removeAttribute('aria-invalid'));

  async function openDoor(day, trigger) {
    if (!state.config) return;
    const door = state.config.doors.find(item => item.day === day);
    if (!door) return;
    if (!state.preview && !isCalendarDayUnlocked(day)) {
      toast(`Noch ein bisschen Vorfreude! Türchen ${day} öffnet ab dem ${day}. ${releaseMonthName()} ${state.config.year} nach der täglichen Freigabe (Europe/Berlin). ✨`);
      return;
    }
    if (!state.preview && door.released === false) {
      // Eine laufende Seite holt den aktuellen Stand nach, auch nach dem Tageswechsel.
      if (await refreshPublicConfiguration()) return openDoor(day, trigger);
      toast('Die heutige Überraschung wird gerade vorbereitet. Schau gleich noch einmal vorbei – sie erscheint hier automatisch. ✨');
      return;
    }
    const request = ++doorRequest;
    resetDoorAudio();
    let image = '';
    try { image = await resolveDoorImage(door); }
    catch (error) { feedback(error.message); }
    if (request !== doorRequest) return;
    state.activeDay = day;
    $('door-eyebrow').textContent = `${state.preview ? 'VORSCHAU · ' : ''}${day}. ${releaseMonthName().toUpperCase()} ${state.config.year} · CREEUNITY`;
    $('door-title').textContent = door.title;
    $('door-image').alt = door.alt || `Grafik zu ${door.title}`;
    $('door-image-button').hidden = !image;
    $('image-error').hidden = Boolean(image);
    if (image) $('door-image').src = image;
    else $('door-image').removeAttribute('src');
    renderFormattedText(door.text, $('door-description'));
    renderActivePuzzle();
    let stored = true;
    if (state.preview) {
      // Vorschau-Öffnungen bleiben getrennt vom echten Fortschritt in dieser Tab-Sitzung.
      state.previewOpened.add(day);
      stored = savePreviewProgress();
    } else {
      state.opened.add(day);
      if (participant.user && participant.available) persistOpened(state.config.year, day);
      else stored = writeStorage(progressKey(), JSON.stringify([...state.opened]));
    }
    renderCalendar();
    // Raster-Buttons wurden ersetzt; Editor-Schaltflächen bleiben als Fokusziel erhalten.
    $('door-modal').onclose = () => {
      if (!document.querySelector('dialog[open]')) {
        const focusTarget = trigger?.isConnected ? trigger : document.querySelector(`.door[data-day="${day}"]`);
        focusTarget?.focus({ preventScroll: true });
      }
      if (!stored) toast('Dein Browser erlaubt gerade keinen lokalen Speicher. Dein Fortschritt bleibt für diesen Besuch erhalten.');
    };
    $('door-modal').showModal();
    $('door-modal').scrollTop = 0;
    renderDoorAudio(door);
  }

  $('doors-grid').addEventListener('click', event => {
    const door = event.target.closest('button[data-day]');
    if (door) openDoor(Number(door.dataset.day), door);
  });
  $('door-image').addEventListener('error', () => { $('door-image-button').hidden = true; $('image-error').hidden = false; });

  // CSS-Vollbild funktioniert auch dort, wo die Fullscreen-API nicht verfügbar ist.
  function fitLightbox() {
    const image = $('lightbox-image');
    if (!image.naturalWidth) return;
    const viewport = $('lightbox-viewport');
    const fit = Math.min((viewport.clientWidth - 16) / image.naturalWidth, (viewport.clientHeight - 16) / image.naturalHeight, 1);
    image.style.width = `${Math.max(1, image.naturalWidth * fit * state.zoom)}px`;
    image.style.height = `${Math.max(1, image.naturalHeight * fit * state.zoom)}px`;
    $('zoom-out').disabled = state.zoom <= 1;
    $('zoom-in').disabled = state.zoom >= 5;
    $('zoom-reset').textContent = state.zoom === 1 ? 'Einpassen' : `${Math.round(state.zoom * 100)} % · Reset`;
  }
  $('door-image-button').addEventListener('click', () => {
    state.zoom = 1;
    $('lightbox-title').textContent = `Türchen ${state.activeDay}`;
    $('lightbox-image').alt = $('door-image').alt;
    $('lightbox-image').src = $('door-image').src;
    $('lightbox').showModal();
    requestAnimationFrame(() => { fitLightbox(); $('lightbox-viewport').scrollTo(0, 0); });
  });
  $('lightbox-image').addEventListener('load', fitLightbox);
  $('zoom-in').addEventListener('click', () => { state.zoom = Math.min(5, state.zoom + .5); fitLightbox(); });
  $('zoom-out').addEventListener('click', () => { state.zoom = Math.max(1, state.zoom - .5); fitLightbox(); });
  $('zoom-reset').addEventListener('click', () => { state.zoom = 1; fitLightbox(); });
  window.addEventListener('resize', () => { if ($('lightbox').open) fitLightbox(); });
  $('lightbox').addEventListener('close', () => { $('lightbox-image').removeAttribute('src'); });

  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  // Ein Klick auf den Backdrop schließt nur den jeweils obersten Dialog.
  document.querySelectorAll('dialog:not(.lightbox)').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  $('info-button').addEventListener('click', () => {
    $('storage-note').textContent = participant.user ? 'Geöffnete Türchen, Sammlung und Rätselpausen sind mit deinem Discord-Konto gespeichert. Zurücksetzen entfernt nur die geöffneten Türchen, auf allen Geräten.' : 'Ohne Anmeldung bleiben geöffnete Türchen nur in diesem Browser. Nach der Anmeldung wird der im Konto gespeicherte Stand verwendet.';
    $('info-modal').showModal();
  });
  $('reset-progress').addEventListener('click', async () => {
    if (!state.config) return;
    if (!resetArmed) {
      resetArmed = true; $('reset-progress').textContent = 'Wirklich zurücksetzen? Erneut klicken';
      $('storage-note').textContent = participant.user ? 'Das setzt die geöffneten Türchen in deinem Konto auf allen Geräten zurück. Gelöste Rätsel und Pausen bleiben erhalten.' : 'Das setzt die geöffneten Türchen in diesem Browser zurück.';
      return;
    }
    const account = accountEpoch;
    const signedIn = !!participant.user;
    const year = state.config.year;
    ++openedEpoch; ++openedWrites;
    $('reset-progress').disabled = true;
    try {
      if (signedIn) {
        await openedQueue;
        if (account !== accountEpoch || !participant.user) throw new Error('Konto gewechselt.');
        await participantAPI.resetOpened(year);
        if (account !== accountEpoch || year !== state.config.year) return;
      }
      state.opened.clear();
      const stored = signedIn || writeStorage(progressKey(), null);
      renderCalendar();
      $('storage-note').textContent = signedIn ? 'Geöffnete Türchen wurden im Konto auf allen Geräten zurückgesetzt. Deine Sammlung und Rätselpausen bleiben erhalten.'
        : stored ? 'Geöffnete Türchen wurden in diesem Browser zurückgesetzt.' : 'Für diesen Besuch zurückgesetzt. Dein Browser blockiert Änderungen am lokalen Speicher.';
    } catch { $('storage-note').textContent = 'Zurücksetzen ist gerade nicht möglich. Bitte versuche es erneut.'; }
    finally {
      --openedWrites; resetArmed = false; $('reset-progress').disabled = false;
      $('reset-progress').textContent = 'Geöffnete Türchen zurücksetzen';
    }
  });
  $('info-modal').addEventListener('close', () => { resetArmed = false; $('reset-progress').textContent = 'Geöffnete Türchen zurücksetzen'; deleteAccountArmed = false; $('delete-account').textContent = 'Meine Kalenderdaten löschen'; $('account-feedback').textContent = ''; });

  // ADMIN: Nur ?admin=true macht den Editor sichtbar. Kein Sicherheitsmechanismus.
  function populateAdmin() {
    state.editor = structuredClone(state.config);
    $('admin-year').value = state.config.year;
    $('admin-release-month').value = String(state.config.releaseMonth ?? 12);
    $('admin-twitch').value = state.config.links.twitch;
    $('admin-discord').value = state.config.links.discord;
    $('preview-toggle').checked = state.preview;
    $('admin-door-picker').replaceChildren();
    for (let day = 1; day <= 24; day++) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = day; button.dataset.day = day;
      button.setAttribute('aria-label', `Türchen ${day} bearbeiten`);
      $('admin-door-picker').append(button);
    }
    showEditorDoor();
  }
  function showEditorDoor() {
    const door = state.editor.doors.find(item => item.day === state.selectedDay);
    $('editing-label').textContent = `Du bearbeitest Türchen ${door.day} von 24`;
    $('admin-door-title').value = door.title;
    $('admin-door-image').value = door.image;
    $('admin-door-audio').value = door.audio || '';
    $('admin-door-alt').value = door.alt;
    $('admin-door-text').value = door.text;
    $('admin-puzzle-type').value = door.puzzle?.type || '';
    $('admin-puzzle-answer').value = door.puzzle?.answer || '';
    $('admin-puzzle-fragment').value = door.puzzle?.fragment || '';
    updatePuzzleEditor();
    updateTextPreview();
    $('admin-door-picker').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.day) === door.day)));
    updateEditorImage();
    updateEditorAudio();
    savePreviewProgress();
  }
  function captureEditor() {
    const door = state.editor.doors.find(item => item.day === state.selectedDay);
    Object.assign(door, { title: $('admin-door-title').value, image: $('admin-door-image').value, alt: $('admin-door-alt').value, text: $('admin-door-text').value });
    if ($('admin-door-audio').value.trim()) door.audio = $('admin-door-audio').value.trim();
    else delete door.audio;
    const type = $('admin-puzzle-type').value;
    if (!type) delete door.puzzle;
    else {
      const answer = $('admin-puzzle-answer').value;
      const previousServer = door.puzzle?.type === type && door.puzzle.serverOnly;
      const previousHash = door.puzzle?.type === type ? door.puzzle.answerHash : undefined;
      door.puzzle = !answer && previousServer ? { type, serverOnly: true }
        : { type, ...(!answer && previousHash ? { answerHash: previousHash } : { answer }), ...(type === 'number' ? { fragment: $('admin-puzzle-fragment').value } : {}) };
    }
    state.editor.year = Number($('admin-year').value);
    state.editor.releaseMonth = Number($('admin-release-month').value);
    state.editor.links = { twitch: $('admin-twitch').value.trim(), discord: $('admin-discord').value.trim() };
  }
  function applyEditor() {
    captureEditor();
    try {
      const config = validateConfig(state.editor);
      const changedYear = state.config.year !== config.year || (state.config.releaseMonth ?? 12) !== (config.releaseMonth ?? 12);
      state.config = config;
      if (changedYear) readProgress();
      updateLinks(); renderCalendar();
      return true;
    } catch (error) { feedback(error.message); return false; }
  }
  $('admin-door-picker').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    captureEditor(); state.selectedDay = Number(button.dataset.day); showEditorDoor();
  });
  function updateTextPreview() {
    const text = $('admin-door-text').value;
    renderFormattedText(text, $('admin-text-preview'));
    $('text-preview-empty').hidden = Boolean(text.trim());
  }
  function updatePuzzleEditor() {
    const type = $('admin-puzzle-type').value;
    $('admin-puzzle-fields').hidden = !type;
    $('admin-puzzle-fragment-label').hidden = type !== 'number';
    $('admin-puzzle-answer').inputMode = type === 'number' ? 'decimal' : 'text';
    const door = state.editor?.doors.find(item => item.day === state.selectedDay);
    $('admin-puzzle-help').textContent = door?.puzzle?.answerHash || door?.puzzle?.serverOnly
      ? 'Die öffentliche Datei enthält keine bearbeitbare Lösung. Verbinde den privaten Kalender, um die gespeicherte Lösung zu bearbeiten.'
      : 'Zahl: richtige Eingabe gibt die Buchstabenfolge frei. Buchstabenfolge: richtige Eingabe bestätigt „Richtig!“. Groß-/Kleinschreibung und Leerzeichen in Buchstabenfolgen werden ignoriert.';
  }
  $('admin-puzzle-type').addEventListener('change', updatePuzzleEditor);
  function applyTextFormat(action) {
    if (githubBusy) return;
    const input = $('admin-door-text');
    const result = formatSelection(input.value, action, input.selectionStart, input.selectionEnd);
    if (result.value.length > input.maxLength) { feedback('Der Text darf einschließlich Formatierungszeichen maximal 10.000 Zeichen enthalten.'); return; }
    input.value = result.value;
    input.focus({ preventScroll: true });
    input.setSelectionRange(result.start, result.end);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  $('admin-door-text').addEventListener('input', updateTextPreview);
  $('text-format-toolbar').addEventListener('click', event => {
    const button = event.target.closest('button[data-format]');
    if (button) applyTextFormat(button.dataset.format);
  });
  $('text-format-extra').addEventListener('change', event => {
    if (event.target.value) applyTextFormat(event.target.value);
    event.target.value = '';
  });
  $('admin-door-text').addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const action = { b: 'bold', i: 'italic', u: 'underline', k: 'link' }[event.key.toLowerCase()];
    if (action) { event.preventDefault(); applyTextFormat(action); }
  });
  function setPreview(enabled) {
    savePreviewProgress();
    state.preview = Boolean(enabled && (adminAccess || designPreview));
    if (state.preview) restorePreviewProgress();
    if (!state.preview) {
      state.previewOpened.clear();
      state.previewSolved = {};
      if (puzzleDemo) { state.config = structuredClone(state.published); updateLinks(); }
      if (designPreview) {
        const url = new URL(location.href);
        url.searchParams.delete('preview');
        history.replaceState(null, '', url);
      }
    }
    if (adminAccess) writeStorage(PREVIEW_KEY, String(state.preview), true);
    $('preview-toggle').checked = state.preview;
    renderParticipant();
    if (!state.preview) refreshParticipant();
    renderCalendar();
  }
  $('preview-toggle').addEventListener('change', event => {
    if (!applyEditor()) { event.target.checked = state.preview; return; }
    setPreview(event.target.checked);
    feedback(state.preview ? 'Vorschau aktiv: Schließe den Editor, um alle Türchen zu testen.' : 'Vorschau beendet. Die Berliner Datumsprüfung ist wieder aktiv.');
  });
  $('end-preview').addEventListener('click', () => setPreview(false));
  $('reset-preview').addEventListener('click', () => {
    if (!state.preview) return;
    state.previewOpened = state.previewOpened.size ? new Set() : new Set([1, 5, 12]);
    state.previewSolved = {};
    savePreviewProgress();
    renderCalendar();
  });
  $('admin-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!applyEditor()) return;
    feedback(writeStorage(DRAFT_KEY, JSON.stringify(state.config)) ? `Entwurf nur in diesem Browser gespeichert.${pendingImages.size ? ' Neu ausgewählte Bilder bitte zusätzlich privat auf GitHub speichern.' : ''}` : 'Lokaler Speicher ist nicht verfügbar. Bitte sichere deinen Entwurf mit „JSON herunterladen“.');
  });
  $('export-config').addEventListener('click', () => {
    if (!applyEditor()) return;
    const blob = new Blob([`${JSON.stringify(state.config, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'doors-data.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    feedback('JSON exportiert. Ersetze doors-data.json ausschließlich im privaten Inhalte-Repository. Niemals vollständige Inhalte ins öffentliche Repository hochladen.');
  });
  $('import-config').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error('Die JSON-Datei ist zu groß (maximal 1 MB).');
      const imported = validateConfig(JSON.parse(await file.text()));
      state.config = imported; state.selectedDay = 1;
      readProgress(); populateAdmin(); updateLinks(); renderCalendar();
      feedback('JSON geladen. Du kannst sie jetzt prüfen und als lokalen Entwurf speichern.');
    } catch (error) { feedback(`Import fehlgeschlagen: ${error.message}`); }
    event.target.value = '';
  });
  $('discard-draft').addEventListener('click', () => {
    if (repository) { feedback('Bitte zuerst abmelden, um zur öffentlichen Ansicht zurückzukehren. Deine privaten Eingaben bleiben bis dahin erhalten.'); return; }
    const removed = writeStorage(DRAFT_KEY, null);
    state.config = structuredClone(state.published); state.selectedDay = 1;
    readProgress(); populateAdmin(); updateLinks(); renderCalendar();
    feedback(removed ? 'Die veröffentlichten Daten sind wieder geladen. Der lokale Entwurf wurde entfernt.' : 'Die veröffentlichten Daten sind geladen. Dein Browser hat das Entfernen des gespeicherten Entwurfs blockiert.');
  });
  $('preview-door').addEventListener('click', event => {
    if (!applyEditor()) return;
    if (!state.preview && !isCalendarDayUnlocked(state.selectedDay)) {
      feedback('Aktiviere zuerst den Vorschaumodus, um dieses zukünftige Türchen zu testen.'); return;
    }
    openDoor(state.selectedDay, event.currentTarget);
  });
  $('admin-image-preview').addEventListener('error', () => { $('admin-image-preview').hidden = true; });
  $('admin-door-image').addEventListener('change', updateEditorImage);
  $('admin-door-audio').addEventListener('change', updateEditorAudio);
  $('admin-audio-remove').addEventListener('click', () => {
    const previous = pendingAudio.get(state.selectedDay);
    if (previous) URL.revokeObjectURL(previous.url);
    pendingAudio.delete(state.selectedDay);
    $('admin-door-audio').value = '';
    captureEditor(); resetEditorAudio();
    feedback('Audio entfernt. Mit Speichern wird die Änderung übernommen.');
  });
  $('admin-audio-upload').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file || githubBusy || !state.editor) return;
    setGitHubBusy(true);
    const day = state.selectedDay;
    try {
      if (file.size > MAX_AUDIO_SIZE) throw new Error('Bitte eine Audiodatei bis maximal 25 MB wählen.');
      captureEditor();
      const bytes = new Uint8Array(await file.arrayBuffer()), type = detectAudio(bytes);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 16);
      const path = `./audio/door-${String(day).padStart(2, '0')}-${digest}.${type.extension}`;
      const previous = pendingAudio.get(day);
      if (previous) URL.revokeObjectURL(previous.url);
      const url = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
      pendingAudio.set(day, { path, bytes, url });
      state.editor.doors.find(door => door.day === day).audio = path;
      showEditorDoor();
      feedback('Audio ausgewählt. Mit „Privat auf GitHub speichern“ wird es zusammen mit dem Türchen gesichert.');
    } catch (error) { feedback(error.message); }
    finally { event.target.value = ''; setGitHubBusy(false); }
  });
  $('admin-image-upload').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file || githubBusy || !state.editor) return;
    setGitHubBusy(true);
    const day = state.selectedDay;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Bitte ein Bild bis maximal 10 MB wählen.');
      captureEditor();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = detectImage(bytes);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 16);
      const path = `./images/door-${String(day).padStart(2, '0')}-${digest}.${type.extension}`;
      const previous = pendingImages.get(day);
      if (previous) URL.revokeObjectURL(previous.url);
      const url = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
      pendingImages.set(day, { path, bytes, url });
      const door = state.editor.doors.find(item => item.day === day);
      door.image = path;
      if (!door.alt) door.alt = `Grafik zu Türchen ${day}`;
      showEditorDoor();
      feedback(repository ? 'Bild ausgewählt. Mit „Privat auf GitHub speichern“ werden Bild und Text zusammen gesichert.' : 'Bild für die Vorschau ausgewählt. Verbinde dich vor dem Hochladen mit dem privaten Kalender.');
    } catch (error) { feedback(error.message); }
    finally { event.target.value = ''; setGitHubBusy(false); }
  });

  async function connectRepository(reload = false, automatic = false) {
    if (githubBusy) return;
    setGitHubBusy(true);
    let candidate;
    const credential = reload ? editorCredential : $('github-token').value.trim() || ($('github-remember').checked ? readStorage(TAB_ACCESS_KEY, true) || '' : '');
    try {
      githubStatus('Privater Kalender wird geladen …');
      candidate = reload ? repository : new GitHubEditor(credential);
      $('github-token').value = '';
      const config = validateConfig(await candidate.load());
      if (repository && repository !== candidate) repository.disconnect();
      repository = candidate;
      editorCredential = credential;
      clearPrivateImages();
      state.config = config; state.selectedDay = 1;
      state.preview = true;
      restorePreviewProgress();
      writeStorage(PREVIEW_KEY, 'true', true);
      readProgress(); updateLinks(); populateAdmin(); renderCalendar();
      $('github-login').hidden = true; $('github-connected').hidden = false;
      const remembered = $('github-remember').checked && writeStorage(TAB_ACCESS_KEY, editorCredential, true);
      if (!$('github-remember').checked) writeStorage(TAB_ACCESS_KEY, null, true);
      if (!remembered) $('github-remember').checked = false;
      githubStatus(`${automatic ? 'Nach dem Neuladen wieder verbunden.' : 'Private Inhalte geladen.'} Die Vorschau ist aktiv.${remembered ? ' Zugang bleibt bei F5 in diesem Tab erhalten.' : ' Ohne gemerkten Zugang ist nach F5 eine neue Verbindung nötig.'}`);
    } catch (error) {
      if (!reload) candidate?.disconnect();
      if (/ungültig|abgelaufen|ausschließlich|Quelldatei|Schreibzugriff/.test(error.message) && readStorage(TAB_ACCESS_KEY, true) === credential) {
        writeStorage(TAB_ACCESS_KEY, null, true); $('github-remember').checked = false;
      }
      githubStatus(`${automatic ? 'Automatisches Verbinden fehlgeschlagen. ' : ''}${error.message}`);
    } finally { $('github-token').value = ''; setGitHubBusy(false); }
  }
  $('github-connect').addEventListener('click', () => connectRepository());
  $('github-remember').addEventListener('change', () => {
    if (!$('github-remember').checked) {
      const removed = writeStorage(TAB_ACCESS_KEY, null, true);
      githubStatus(removed ? 'Gemerkter Zugang entfernt. Die aktuelle Verbindung bleibt bis zum Neuladen oder Abmelden aktiv.' : 'Dein Browser blockiert das Entfernen des gemerkten Zugangs.');
    } else if (editorCredential) {
      const saved = writeStorage(TAB_ACCESS_KEY, editorCredential, true);
      if (!saved) $('github-remember').checked = false;
      githubStatus(saved ? 'Zugang bleibt bei F5 in diesem Tab erhalten. Abmelden entfernt ihn wieder.' : 'Dein Browser blockiert das Merken des Zugangs.');
    }
  });
  $('github-token').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); connectRepository(); } });
  $('github-reload').addEventListener('click', () => connectRepository(true));
  $('github-save').addEventListener('click', async () => {
    if (!repository || githubBusy || !applyEditor()) return;
    setGitHubBusy(true);
    try {
      const images = [...pendingImages.values()].filter(item => state.config.doors.some(door => door.image === item.path)).map(({ path, bytes }) => ({ path, bytes }));
      const audios = [...pendingAudio.values()].filter(item => state.config.doors.some(door => door.audio === item.path)).map(({ path, bytes }) => ({ path, bytes }));
      feedback('Texte, Bilder und Audios werden privat gespeichert …');
      await repository.save(state.config, images, audios);
      for (const item of pendingImages.values()) {
        if (state.config.doors.some(door => door.image === item.path)) privatePreviews.set(privateImagePath(item.path), item.url);
        else URL.revokeObjectURL(item.url);
      }
      pendingImages.clear();
      for (const item of pendingAudio.values()) {
        if (state.config.doors.some(door => door.audio === item.path)) privateAudioPreviews.set(privateAudioPath(item.path), item.url);
        else URL.revokeObjectURL(item.url);
      }
      pendingAudio.clear();
      feedback('Auf GitHub gespeichert ✓ Künftige Türchen bleiben privat. Bereits fällige Inhalte werden nach der automatischen Veröffentlichung sichtbar.');
    } catch (error) { feedback(error.message); }
    finally { setGitHubBusy(false); }
  });
  $('github-disconnect').addEventListener('click', () => {
    forgetEditorTabState(); editorCredential = ''; $('github-remember').checked = false;
    repository?.disconnect(); repository = null; ++doorRequest;
    clearPrivateImages();
    state.config = structuredClone(state.published); state.preview = false; state.selectedDay = 1;
    state.previewOpened.clear();
    state.previewSolved = {};
    writeStorage(PREVIEW_KEY, 'false', true);
    readProgress(); updateLinks(); populateAdmin(); renderCalendar();
    $('door-title').textContent = ''; $('door-description').replaceChildren();
    $('door-puzzle').hidden = true; $('puzzle-answer').value = ''; $('puzzle-feedback').textContent = '';
    $('door-image').removeAttribute('src'); $('admin-image-preview').removeAttribute('src'); $('admin-image-preview').hidden = true;
    $('github-login').hidden = false; $('github-connected').hidden = true;
    githubStatus('Abgemeldet. Ein ausdrücklich lokal gespeicherter Entwurf bleibt in diesem Browser erhalten.');
    setGitHubBusy(false);
  });
  if (adminAccess) {
    $('admin-entry').hidden = false;
    $('admin-entry').addEventListener('click', event => { event.preventDefault(); if (state.config) $('admin-modal').showModal(); });
  }
  // Beim Schließen auch ungespeicherte Felder übernehmen, sofern sie gültig sind.
  $('admin-modal').addEventListener('close', () => {
    if (state.config && !applyEditor()) {
      // Ungültige Eingaben bleiben im Editor erhalten; der letzte gültige Stand bleibt aktiv.
      toast('Einige Eingaben sind ungültig. Bitte prüfe den Editor vor dem Export.');
    }
  });
  $('retry-load').addEventListener('click', loadConfiguration);
  async function refreshPublicConfiguration() {
    if (adminAccess || refreshing || !state.config || Date.now() - refreshTime < 10000) return false;
    refreshing = true; refreshTime = Date.now();
    try {
      const response = await fetch(`./doors-data.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return false;
      const config = validateConfig(await response.json());
      const changed = JSON.stringify(config) !== JSON.stringify(state.published);
      if (changed) {
        const yearChanged = state.config.year !== config.year || (state.config.releaseMonth ?? 12) !== (config.releaseMonth ?? 12);
        state.published = structuredClone(config);
        if (puzzleDemo && state.preview) return false;
        state.config = config;
        if (yearChanged) readProgress();
        updateLinks(); renderCalendar();
      }
      return changed;
    } catch { return false; }
    finally { refreshing = false; }
  }
  // Neuer Tag, Rückkehr aus Standby und Änderungen in einem anderen Tab.
  setInterval(() => { renderCalendar(); renderAttemptState(); }, 1000);
  setInterval(() => { if (!document.hidden) { refreshPublicConfiguration(); refreshParticipant(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderCalendar(); refreshPublicConfiguration(); refreshParticipant(); } });
  window.addEventListener('storage', event => { if (state.config && event.key === progressKey() && !participant.user) { readProgress(); renderCalendar(); if ($('door-modal').open) renderActivePuzzle(); } });
  window.addEventListener('pagehide', savePreviewProgress);
  loadConfiguration();
  const loginResult = new URL(location.href).searchParams.get('login');
  if (loginResult) {
    toast(loginResult === 'success' ? 'Mit Discord angemeldet.' : loginResult === 'cancelled' ? 'Discord-Anmeldung abgebrochen.' : 'Die Discord-Anmeldung hat nicht geklappt. Bitte versuche es erneut.');
    const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('login'); history.replaceState(null, '', cleanUrl);
  }
}
