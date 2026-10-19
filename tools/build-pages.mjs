// Nur diese Dateien dürfen im Pages-Artefakt landen. Insbesondere keine privaten Inhalte.
import { mkdir, cp, lstat, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve('.');
const out = resolve(root, '_site');
await mkdir(out, { recursive: true });
if ((await readdir(out)).length) throw new Error('_site muss vor dem Build leer sein.');
for (const name of ['index.html', 'styles.css', 'script.js', 'doors-data.json', '.nojekyll']) {
  if (!(await lstat(join(root, name))).isFile()) throw new Error('Eine öffentliche Datei ist ungültig.');
  await cp(join(root, name), join(out, name));
}
async function copyAssets(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symbolische Links sind im Pages-Artefakt nicht erlaubt.');
    if (entry.isDirectory()) await copyAssets(join(source, entry.name), join(destination, entry.name));
    else if (entry.isFile()) await cp(join(source, entry.name), join(destination, entry.name));
  }
}
await copyAssets(join(root, 'assets'), join(out, 'assets'));
console.log('Öffentliche Website in _site vorbereitet.');
