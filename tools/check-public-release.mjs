// Wiederholbarer, ausschließlich lesender Live-Test ohne GitHub-Zugriffsschlüssel.
// Prüft den aktuellen öffentlichen Stand; bewertet keine frühere Git-Historie.
import assert from 'node:assert/strict';
import { getBerlinDateParts, isDoorUnlocked, validateConfig } from '../script.js';
import { CONTENT_REPOSITORY } from '../github-editor.js';

const website = 'https://m4sterchris.github.io/creeunity-adventskalender-2026/';
const publicRepo = 'M4sterChris/creeunity-adventskalender-2026';
const now = new Date();
const berlin = getBerlinDateParts(now);

async function get(url) {
  const response = await fetch(url, {
    cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'CreeUnity-public-release-check' },
  });
  // Kein Rate-Limit oder Netzwerkfehler darf versehentlich als bestandener Zugriffsschutz gelten.
  if ([403, 429].includes(response.status)) throw new Error('Live-Prüfung durch Zugriffslimit blockiert. Später erneut starten.');
  return response;
}

try {
  console.log(`Live-Prüfung · ${berlin.day}.${berlin.month}.${berlin.year} · Europe/Berlin`);
  const response = await get(`${website}doors-data.json?check=${Date.now()}`);
  assert.equal(response.status, 200, 'Öffentliche Kalenderdatei ist nicht erreichbar.');
  const config = validateConfig(await response.json());
  assert.equal(config.releaseMode, 'daily', 'Die Website benötigt die gefilterte Tagesdatei.');
  const future = config.doors.filter(door => !isDoorUnlocked(door.day, config.year, now));
  for (const door of future) {
    // Nur Nummern und Status melden, niemals eventuell versehentlich veröffentlichte Werte ausgeben.
    const neutral = door.released === false && door.text === '' && door.image === './assets/placeholder.svg'
      && door.title === `Türchen ${door.day} – Noch ein bisschen Vorfreude`
      && door.alt === 'Die Überraschung ist noch nicht veröffentlicht.';
    assert.ok(neutral, `Türchen ${door.day}: Zukünftige Metadaten sind öffentlich. Bitte prüfen.`);
  }
  console.log(`PASS: ${future.length} zukünftige Türchen enthalten ausschließlich neutrale Platzhalter.`);

  const treeResponse = await get(`https://api.github.com/repos/${publicRepo}/git/trees/main?recursive=1`);
  assert.equal(treeResponse.status, 200, 'Öffentliche Repository-Dateiliste ist nicht prüfbar.');
  const tree = await treeResponse.json();
  assert.equal(tree.truncated, false, 'Repository-Dateiliste ist unvollständig.');
  const forbidden = tree.tree.some(entry => /^(?:\.private-repository|\.qa|images)\//.test(entry.path)
    || /^\.env(?:\.|$)/.test(entry.path) || /\.(?:pem|key)$/i.test(entry.path));
  assert.ok(!forbidden, 'Private Arbeitsdateien oder ungeschützte Bilderpfade im öffentlichen Repository gefunden.');
  const publishedImages = tree.tree.filter(entry => entry.type === 'blob' && /^assets\/released\//.test(entry.path));
  for (const entry of publishedImages) {
    const match = /^assets\/released\/(\d{4})\/day-(\d{2})-[a-f0-9]+\.[a-z0-9]+$/i.exec(entry.path);
    assert.ok(match, 'Eine veröffentlichte Bilddatei kann keinem Freigabetag zugeordnet werden.');
    assert.ok(isDoorUnlocked(Number(match[2]), Number(match[1]), now), 'Eine zukünftige Tagesgrafik liegt bereits im öffentlichen Repository.');
  }
  console.log('PASS: Keine zukünftigen Tagesgrafiken oder privaten Arbeitsdateien im aktuellen öffentlichen Repository.');

  const privateResponse = await get(`https://api.github.com/repos/${CONTENT_REPOSITORY}`);
  assert.equal(privateResponse.status, 404, 'Das Inhalte-Repository ist ohne Anmeldung sichtbar.');
  const privateFile = await get(`https://raw.githubusercontent.com/${CONTENT_REPOSITORY}/main/doors-data.json`);
  assert.equal(privateFile.status, 404, 'Die private Kalenderdatei ist ohne Anmeldung erreichbar.');
  console.log('PASS: Inhalte-Repository und private Kalenderdatei sind ohne Anmeldung nicht erreichbar.');

  for (const path of ['.private-repository/doors-data.json', '.env', '.git/config']) {
    const probe = await get(new URL(path, website));
    assert.equal(probe.status, 404, 'Ein privater Arbeitsdateipfad wird über Pages ausgeliefert.');
  }
  console.log('PASS: Private Arbeitsdateien werden nicht über GitHub Pages ausgeliefert.');
  console.log('BESTANDEN: Der aktuelle öffentliche Stand hat alle Live-Prüfungen bestanden.');
} catch (error) {
  // Keine Response-Inhalte oder Assertion-Werte ausgeben: diese könnten echte Inhalte enthalten.
  console.error(`NICHT BESTANDEN / NICHT PRÜFBAR: ${error.message}`);
  process.exitCode = 1;
}
