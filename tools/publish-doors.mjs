// Wird ausschließlich im privaten Inhalte-Repository ausgeführt. Keine privaten Werte loggen.
import { readFile, writeFile, mkdir, realpath, rename, stat } from 'node:fs/promises';
import { resolve, relative, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateConfig, isDoorUnlocked } from '../script.js';

/** Neue Objektstruktur statt Entfernen einzelner Felder: Künftige Inhalte bleiben privat. */
export function selectReleasedContents(input, now = new Date()) {
  const config = validateConfig(input);
  return {
    version: 1, year: config.year, links: config.links, releaseMode: 'daily',
    doors: config.doors.map(door => isDoorUnlocked(door.day, config.year, now) ? {
      day: door.day, title: door.title, image: door.image, alt: door.alt, text: door.text, released: true,
    } : {
      day: door.day, title: `Türchen ${door.day} – Noch ein bisschen Vorfreude`,
      image: './assets/placeholder.svg', alt: 'Die Überraschung ist noch nicht veröffentlicht.', text: '', released: false,
    }),
  };
}

export function localImagePath(image) {
  const path = image.replace(/^\.\//, '');
  if (!/^images\/[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').some(part => ['..', '.', ''].includes(part))) {
    throw new Error('Lokale Grafiken müssen im privaten images/-Ordner liegen; keine absoluten Pfade oder übergeordneten Verzeichnisse.');
  }
  if (!['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg'].includes(extname(path).toLowerCase())) throw new Error('Nicht unterstütztes Bildformat.');
  return path;
}

export async function publishDoors({ source, target, now = new Date() }) {
  const sourceRoot = await realpath(source);
  const targetRoot = await realpath(target);
  if (sourceRoot === targetRoot) throw new Error('Privates Inhalte- und öffentliches Website-Verzeichnis müssen getrennt sein.');
  const input = JSON.parse(await readFile(resolve(sourceRoot, 'doors-data.json'), 'utf8'));
  const output = selectReleasedContents(input, now);
  const copies = [];
  // Nur veröffentlichte Grafiken lesen. Ein fehlerhaftes zukünftiges Bild blockiert den heutigen Tag nicht.
  for (const door of output.doors.filter(item => item.released)) {
    if (/^https:\/\//i.test(door.image)) continue;
    const path = localImagePath(door.image);
    const imagePath = await realpath(resolve(sourceRoot, path));
    const imageRoot = resolve(sourceRoot, 'images');
    if (!imagePath.startsWith(`${imageRoot}${sep}`)) throw new Error('Ein Bild verweist außerhalb des privaten images/-Ordners.');
    const info = await stat(imagePath);
    if (!info.isFile() || info.size > 25 * 1024 * 1024) throw new Error('Eine veröffentlichte Grafik fehlt oder ist größer als 25 MB.');
    const bytes = await readFile(imagePath);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    // Inhaltsabhängige Dateinamen verhindern, dass ein Browser eine alte Grafik cached.
    const destination = `assets/released/${output.year}/day-${String(door.day).padStart(2, '0')}-${hash}${extname(path).toLowerCase()}`;
    copies.push({ destination, bytes });
    door.image = `./${destination}`;
  }
  // Erst nach vollständiger Prüfung schreiben. Keine privaten Dateinamen in Fehlermeldungen.
  for (const { destination, bytes } of copies) {
    const path = resolve(targetRoot, destination);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  const json = `${JSON.stringify(output, null, 2)}\n`;
  const path = resolve(targetRoot, 'doors-data.json');
  let before = '';
  try { before = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (before !== json) { await writeFile(`${path}.tmp`, json); await rename(`${path}.tmp`, path); }
  return { released: output.doors.filter(door => door.released).length, year: output.year, changed: before !== json };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowed = new Set(['--source', '--target']);
  try {
    if (args.length !== 4 || !allowed.has(args[0]) || !allowed.has(args[2]) || args[0] === args[2]) throw new Error('Aufruf: node tools/publish-doors.mjs --source PRIVATES_VERZEICHNIS --target WEBSITE_VERZEICHNIS');
    const options = Object.fromEntries([[args[0].slice(2), args[1]], [args[2].slice(2), args[3]]]);
    // Die CLI akzeptiert bewusst kein Vorschau-Datum; die Action nutzt ausschließlich Runner-Zeit.
    const result = await publishDoors(options);
    console.log(`${result.released}/24 Türchen für ${result.year} freigegeben. ${result.changed ? 'Kalender aktualisiert.' : 'Kalender unverändert.'}`);
  } catch {
    console.error('Veröffentlichung abgebrochen. Bitte prüfe JSON-Struktur, Datum und Bilddateien im privaten Repository. Es wurden keine privaten Inhalte protokolliert.');
    process.exitCode = 1;
  }
}
