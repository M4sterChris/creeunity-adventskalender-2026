/* Direkter Zugriff vom Browser auf GitHub. Diese Klasse hält den Schlüssel im Arbeitsspeicher.
 * Die Oberfläche kann ihn auf ausdrücklichen Wunsch zusätzlich in sessionStorage merken.
 * Keine Tokens in URLs, localStorage, Fehlertexten oder im Repository speichern.
 */
export const CONTENT_REPOSITORY = 'M4sterChris/creeunity-adventskalender-2026-inhalte';
const ROOT = `https://api.github.com/repos/${CONTENT_REPOSITORY}`;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export function encodeBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeText(content) {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.replace(/\s/g, '')), c => c.charCodeAt(0)));
}
export function privateImagePath(value) {
  const path = String(value).replace(/^\.\//, '');
  if (!/^images\/[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').some(p => ['..', '.', ''].includes(p))) throw new Error('Bitte eine Bilddatei aus dem privaten images/-Ordner verwenden.');
  return path;
}
export function detectImage(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length < 12 || bytes.length > MAX_IMAGE_SIZE) throw new Error('Bitte ein Bild bis maximal 10 MB wählen.');
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return { extension: 'png', mime: 'image/png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: 'jpg', mime: 'image/jpeg' };
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { extension: 'gif', mime: 'image/gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return { extension: 'avif', mime: 'image/avif' };
  throw new Error('Bitte PNG, JPG, WebP, GIF oder AVIF hochladen.');
}

export class GitHubEditor {
  #token;
  #fetch;
  #configSHA = null;
  #head = null;
  constructor(token, fetcher = globalThis.fetch) {
    if (typeof token !== 'string' || !token.trim() || /\s/.test(token.trim())) throw new Error('Bitte einen gültigen GitHub-Zugriffsschlüssel eingeben.');
    // Browser-fetch benötigt Window als Aufrufkontext; ein Klassen-Receiver wäre ungültig.
    this.#token = token.trim(); this.#fetch = fetcher.bind(globalThis);
  }
  disconnect() { this.#token = ''; this.#configSHA = null; this.#head = null; }
  async #request(path, { method = 'GET', body, raw = false } = {}) {
    if (!this.#token) throw new Error('Bitte erneut mit GitHub verbinden.');
    let response;
    try {
      response = await this.#fetch(`${ROOT}${path ? `/${path}` : ''}`, {
        method, headers: { Authorization: `Bearer ${this.#token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', credentials: 'omit', redirect: 'error',
      });
    } catch { throw new Error('GitHub ist gerade nicht erreichbar. Deine Eingaben bleiben im Editor.'); }
    if (!response.ok) {
      if ([409, 422].includes(response.status)) throw new Error('Zwischenzeitlich wurden Inhalte geändert. Bitte erst deinen Entwurf exportieren und anschließend den aktuellen Stand laden.');
      if (response.status === 401) throw new Error('Der Zugriffsschlüssel ist ungültig oder abgelaufen. Bitte erneut verbinden.');
      if ([403, 404].includes(response.status)) throw new Error('Kein Zugriff. Bitte Repository-Auswahl, Schreibberechtigung „Contents“ und gegebenenfalls das GitHub-Anfragelimit prüfen.');
      throw new Error(`GitHub konnte die Änderung nicht verarbeiten (HTTP ${response.status}).`);
    }
    if (raw) return response.blob();
    return response.status === 204 ? null : response.json();
  }
  async load() {
    const repo = await this.#request('');
    if (!repo.private || repo.full_name.toLowerCase() !== CONTENT_REPOSITORY.toLowerCase()) throw new Error('Der Editor verbindet sich ausschließlich mit dem vorgesehenen privaten Inhalte-Repository.');
    if (repo.permissions?.push === false) throw new Error('Für den Editor ist Schreibzugriff auf das private Inhalte-Repository erforderlich.');
    const head = await this.#request('git/ref/heads/main');
    const file = await this.#request(`contents/doors-data.json?ref=${encodeURIComponent(head.object.sha)}`);
    if (file.encoding !== 'base64' || !file.content) throw new Error('Die private Kalenderdatei konnte nicht geladen werden.');
    const config = JSON.parse(decodeText(file.content));
    if (config.releaseMode === 'daily') throw new Error('Im privaten Repository muss die vollständige Quelldatei liegen, keine öffentliche Datei mit Platzhaltern.');
    this.#head = head.object.sha; this.#configSHA = file.sha;
    return config;
  }
  async image(value) {
    const path = privateImagePath(value);
    return this.#request(`contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(this.#head)}`, { raw: true });
  }
  async save(config, images = []) {
    if (!this.#configSHA) throw new Error('Bitte zunächst die privaten Inhalte laden.');
    if (config.releaseMode === 'daily') throw new Error('Bitte zunächst die vollständigen privaten Inhalte laden.');
    const head = await this.#request('git/ref/heads/main');
    const file = await this.#request(`contents/doors-data.json?ref=${encodeURIComponent(head.object.sha)}`);
    if (file.sha !== this.#configSHA) throw new Error('Die Kalenderinhalte wurden inzwischen von jemand anderem geändert. Bitte deinen Entwurf exportieren und anschließend den aktuellen Stand laden.');
    const parent = await this.#request(`git/commits/${head.object.sha}`);
    const entries = [];
    // Dateien und Konfiguration werden gemeinsam in genau einem Commit gespeichert.
    for (const { path, bytes } of images) {
      const clean = privateImagePath(path); detectImage(bytes);
      const blob = await this.#request('git/blobs', { method: 'POST', body: { content: encodeBase64(bytes), encoding: 'base64' } });
      entries.push({ path: clean, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const json = `${JSON.stringify(config, null, 2)}\n`;
    const blob = await this.#request('git/blobs', { method: 'POST', body: { content: encodeBase64(new TextEncoder().encode(json)), encoding: 'base64' } });
    entries.push({ path: 'doors-data.json', mode: '100644', type: 'blob', sha: blob.sha });
    const tree = await this.#request('git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: entries } });
    const commit = await this.#request('git/commits', { method: 'POST', body: { message: 'Update Advent calendar content in web editor', tree: tree.sha, parents: [head.object.sha] } });
    // Ohne force: Parallele Änderungen dürfen niemals überschrieben werden.
    await this.#request('git/refs/heads/main', { method: 'PATCH', body: { sha: commit.sha, force: false } });
    this.#head = commit.sha; this.#configSHA = blob.sha;
    return { sha: commit.sha };
  }
}
