/* CreeUnity Adventskalender – Vanilla JS, ohne Build-Schritt.
 * Die öffentliche Konfiguration enthält nur bereits veröffentlichte Tagesinhalte.
 * Die tägliche GitHub Action liest die vollständigen Inhalte aus einem privaten Repository.
 */
import { GitHubEditor, detectImage, privateImagePath } from './github-editor.js';
import { renderFormattedText, formatSelection } from './text-format.js';
import { validatePuzzle, puzzleIdentity, checkPuzzleAnswer } from './puzzles.js';

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
export function isDoorUnlocked(day, year, date = new Date()) {
  if (!Number.isInteger(day) || day < 1 || day > 24) return false;
  const berlin = getBerlinDateParts(date);
  return berlin.year > year || (berlin.year === year && berlin.month === 12 && berlin.day >= day);
}

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
    if (input.releaseMode === 'daily' && typeof door.released !== 'boolean') throw new Error(`Türchen ${door.day}: Die Veröffentlichungsangabe fehlt.`);
    let puzzle;
    try { puzzle = validatePuzzle(door.puzzle); } catch (error) { throw new Error(`Türchen ${door.day}: ${error.message}`); }
    return { day: door.day, title: door.title.trim(), image: door.image.trim(), alt: door.alt || '', text: door.text,
      ...(puzzle ? { puzzle } : {}),
      ...(input.releaseMode === 'daily' ? { released: door.released } : {}) };
  }).sort((a, b) => a.day - b.day);
  const links = input.links || {};
  for (const name of ['twitch', 'discord']) {
    if (links[name] && !safeUrl(links[name])) throw new Error(`Bitte eine gültige HTTPS-URL für ${name} eingeben.`);
  }
  return { version: 1, year: input.year, links: { twitch: links.twitch || '', discord: links.discord || '' },
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

  function clearPrivateImages() {
    privateImageGeneration++;
    for (const item of pendingImages.values()) URL.revokeObjectURL(item.url);
    for (const url of privatePreviews.values()) URL.revokeObjectURL(url);
    pendingImages.clear(); privatePreviews.clear(); privateImageLoads.clear();
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
  const progressKey = () => `creeunity:opened:${state.config.year}`;
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

  function readProgress() {
    try {
      const saved = JSON.parse(readStorage(progressKey()) || '[]');
      state.opened = new Set(Array.isArray(saved) ? saved.filter(n => Number.isInteger(n) && n >= 1 && n <= 24) : []);
    } catch { state.opened = new Set(); }
    try {
      const saved = JSON.parse(readStorage(solvedKey()) || '{}');
      state.solved = savedSolutions(saved);
    } catch { state.solved = {}; }
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
    $('footer-year').textContent = state.config.year;
    document.title = `CreeUnity Adventskalender · ${state.config.year}`;
  }

  function solvedPuzzles() {
    const records = state.preview ? state.previewSolved : state.solved;
    return state.config.doors.filter(door => door.puzzle && (state.preview || (isDoorUnlocked(door.day, state.config.year) && door.released !== false)) && records[door.day]?.identity === puzzleIdentity(door.puzzle));
  }

  function renderPuzzleCollection(solved) {
    const enabled = state.config.doors.some(door => door.puzzle && (state.preview || (isDoorUnlocked(door.day, state.config.year) && door.released !== false)));
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
    const december = berlin.year === year && berlin.month === 12;
    // Kein sekündlicher DOM-Austausch: Tastaturfokus und Screenreader bleiben stabil.
    const visibleOpened = state.preview ? state.previewOpened : state.opened;
    const solved = solvedPuzzles();
    const signature = JSON.stringify([year, berlin, state.preview, [...visibleOpened], solved.map(d => d.day), state.config.doors.map(d => [d.released, d.image, puzzleIdentity(d.puzzle)])]);
    if (signature === lastRender) return;
    lastRender = signature;
    $('calendar-status').textContent = state.preview ? 'Die CreeUnity-Werkstatt ist geöffnet'
      : berlin.year < year || (berlin.year === year && berlin.month < 12) ? `Die Vorfreude beginnt · ab 1. Dezember ${year}`
      : december && berlin.day <= 24 ? `${berlin.day}. Dezember · Dein Wintermoment wartet`
      : '24 Türchen voller CreeUnity-Momente';
    const fragment = document.createDocumentFragment();
    for (const day of getDoorOrder(year)) {
      const door = state.config.doors.find(item => item.day === day);
      const opened = visibleOpened.has(door.day);
      const unlocked = isDoorUnlocked(door.day, year, now) && door.released !== false;
      const today = december && berlin.day === door.day;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `door${opened ? ' is-opened' : ''}${today ? ' is-today' : ''}${door.day === 24 ? ' is-finale' : ''}`;
      button.dataset.day = door.day;
      const isSolved = solved.some(item => item.day === door.day);
      button.setAttribute('aria-label', `Türchen ${door.day}${opened ? ', bereits geöffnet' : ''}${isSolved ? ', Rätsel gelöst' : ''}${today ? ', heute' : ''}${!unlocked && !state.preview ? `, öffnet am ${door.day}. Dezember ${year}` : ''}`);
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
    const available = door && (state.preview || (isDoorUnlocked(door.day, state.config.year) && door.released !== false));
    $('door-puzzle').hidden = !available || !door.puzzle;
    $('puzzle-answer').value = '';
    $('puzzle-answer').removeAttribute('aria-invalid');
    $('puzzle-feedback').textContent = '';
    $('puzzle-feedback').className = 'puzzle-feedback';
    if (!available || !door.puzzle) return;
    const number = door.puzzle.type === 'number';
    $('puzzle-answer-label').textContent = number ? 'Deine Zahl' : 'Deine Buchstabenfolge';
    $('puzzle-answer').inputMode = number ? 'decimal' : 'text';
    $('puzzle-answer').placeholder = number ? 'Zahl eingeben' : 'Buchstaben eingeben';
    const done = solvedPuzzles().some(item => item.day === door.day);
    $('puzzle-form').hidden = done;
    if (done) {
      $('puzzle-feedback').textContent = number ? `✓ Richtig! Die heutige Buchstabenfolge ist ${door.puzzle.fragment}` : '✓ Richtig!';
      $('puzzle-feedback').classList.add('is-correct');
    }
  }

  $('puzzle-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('puzzle-check').disabled) return;
    const day = state.activeDay;
    const door = state.config.doors.find(item => item.day === day);
    if (!door?.puzzle || (!state.preview && (!isDoorUnlocked(day, state.config.year) || door.released === false))) return;
    const year = state.config.year;
    const preview = state.preview;
    const identity = puzzleIdentity(door.puzzle);
    $('puzzle-check').disabled = true;
    try {
      const result = await checkPuzzleAnswer(door.puzzle, $('puzzle-answer').value, year, day);
      if (state.activeDay !== day || state.config.year !== year || state.preview !== preview || puzzleIdentity(state.config.doors.find(item => item.day === day)?.puzzle) !== identity) return;
      if (!result.correct) {
        $('puzzle-feedback').textContent = 'Noch nicht ganz – versuch es noch einmal.';
        $('puzzle-answer').setAttribute('aria-invalid', 'true');
        return;
      }
      const records = preview ? state.previewSolved : state.solved;
      records[day] = { identity, fragment: result.fragment };
      const stored = preview ? savePreviewProgress() : writeStorage(solvedKey(), JSON.stringify(state.solved));
      renderCalendar(); renderActivePuzzle();
      if (!stored) $('puzzle-feedback').textContent += ' Für diesen Besuch gemerkt; dein Browser blockiert die Speicherung.';
    } catch {
      $('puzzle-feedback').textContent = 'Die Prüfung ist gerade nicht verfügbar. Bitte lade die Seite über HTTPS neu.';
    } finally { $('puzzle-check').disabled = false; }
  });
  $('puzzle-answer').addEventListener('input', () => $('puzzle-answer').removeAttribute('aria-invalid'));

  async function openDoor(day, trigger) {
    if (!state.config) return;
    const door = state.config.doors.find(item => item.day === day);
    if (!door) return;
    if (!state.preview && !isDoorUnlocked(day, state.config.year)) {
      toast(`Noch ein bisschen Vorfreude! Türchen ${day} öffnet ab dem ${day}. Dezember ${state.config.year} nach der täglichen Freigabe (Europe/Berlin). ✨`);
      return;
    }
    if (!state.preview && door.released === false) {
      // Eine laufende Seite holt den aktuellen Stand nach, auch nach dem Tageswechsel.
      if (await refreshPublicConfiguration()) return openDoor(day, trigger);
      toast('Die heutige Überraschung wird gerade vorbereitet. Schau gleich noch einmal vorbei – sie erscheint hier automatisch. ✨');
      return;
    }
    const request = ++doorRequest;
    let image = '';
    try { image = await resolveDoorImage(door); }
    catch (error) { feedback(error.message); }
    if (request !== doorRequest) return;
    state.activeDay = day;
    $('door-eyebrow').textContent = `${state.preview ? 'VORSCHAU · ' : ''}${day}. DEZEMBER ${state.config.year} · CREEUNITY`;
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
      stored = writeStorage(progressKey(), JSON.stringify([...state.opened]));
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
    $('storage-note').textContent = state.storageOK ? 'Der Fortschritt wird nur in diesem Browser und pro Kalenderjahr gespeichert.' : 'Dein Browser hat den lokalen Speicher blockiert. Fortschritt wird nur für diesen Besuch behalten.';
    $('info-modal').showModal();
  });
  $('reset-progress').addEventListener('click', () => {
    if (!state.config) return;
    if (!resetArmed) { resetArmed = true; $('reset-progress').textContent = 'Wirklich zurücksetzen? Erneut klicken'; return; }
    state.opened.clear();
    state.solved = {};
    const openedStored = writeStorage(progressKey(), null);
    const solvedStored = writeStorage(solvedKey(), null);
    const stored = openedStored && solvedStored;
    renderCalendar();
    resetArmed = false;
    $('reset-progress').textContent = 'Meinen Fortschritt zurücksetzen';
    $('storage-note').textContent = stored ? 'Dein Fortschritt für diesen Kalender wurde zurückgesetzt.' : 'Für diesen Besuch zurückgesetzt. Dein Browser blockiert Änderungen am lokalen Speicher.';
  });
  $('info-modal').addEventListener('close', () => { resetArmed = false; $('reset-progress').textContent = 'Meinen Fortschritt zurücksetzen'; });

  // ADMIN: Nur ?admin=true macht den Editor sichtbar. Kein Sicherheitsmechanismus.
  function populateAdmin() {
    state.editor = structuredClone(state.config);
    $('admin-year').value = state.config.year;
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
    $('admin-door-alt').value = door.alt;
    $('admin-door-text').value = door.text;
    $('admin-puzzle-type').value = door.puzzle?.type || '';
    $('admin-puzzle-answer').value = door.puzzle?.answer || '';
    $('admin-puzzle-fragment').value = door.puzzle?.fragment || '';
    updatePuzzleEditor();
    updateTextPreview();
    $('admin-door-picker').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.day) === door.day)));
    updateEditorImage();
    savePreviewProgress();
  }
  function captureEditor() {
    const door = state.editor.doors.find(item => item.day === state.selectedDay);
    Object.assign(door, { title: $('admin-door-title').value, image: $('admin-door-image').value, alt: $('admin-door-alt').value, text: $('admin-door-text').value });
    const type = $('admin-puzzle-type').value;
    if (!type) delete door.puzzle;
    else {
      const answer = $('admin-puzzle-answer').value;
      const previousHash = door.puzzle?.type === type ? door.puzzle.answerHash : undefined;
      door.puzzle = { type, ...(!answer && previousHash ? { answerHash: previousHash } : { answer }), ...(type === 'number' ? { fragment: $('admin-puzzle-fragment').value } : {}) };
    }
    state.editor.year = Number($('admin-year').value);
    state.editor.links = { twitch: $('admin-twitch').value.trim(), discord: $('admin-discord').value.trim() };
  }
  function applyEditor() {
    captureEditor();
    try {
      const config = validateConfig(state.editor);
      const changedYear = state.config.year !== config.year;
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
    $('admin-puzzle-help').textContent = door?.puzzle?.answerHash
      ? 'Die öffentliche Datei enthält nur einen Prüfwert. Verbinde den privaten Kalender, um die gespeicherte Lösung zu bearbeiten.'
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
    if (!state.preview && !isDoorUnlocked(state.selectedDay, state.config.year)) {
      feedback('Aktiviere zuerst den Vorschaumodus, um dieses zukünftige Türchen zu testen.'); return;
    }
    openDoor(state.selectedDay, event.currentTarget);
  });
  $('admin-image-preview').addEventListener('error', () => { $('admin-image-preview').hidden = true; });
  $('admin-door-image').addEventListener('change', updateEditorImage);
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
      feedback('Texte und Bilder werden privat gespeichert …');
      await repository.save(state.config, images);
      for (const item of pendingImages.values()) {
        if (state.config.doors.some(door => door.image === item.path)) privatePreviews.set(privateImagePath(item.path), item.url);
        else URL.revokeObjectURL(item.url);
      }
      pendingImages.clear();
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
        const yearChanged = state.config.year !== config.year;
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
  setInterval(renderCalendar, 1000);
  setInterval(() => { if (!document.hidden) refreshPublicConfiguration(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderCalendar(); refreshPublicConfiguration(); } });
  window.addEventListener('storage', event => { if (state.config && [progressKey(), solvedKey()].includes(event.key)) { readProgress(); renderCalendar(); if ($('door-modal').open) renderActivePuzzle(); } });
  window.addEventListener('pagehide', savePreviewProgress);
  loadConfiguration();
}
