// Einmaliges Erstellen eines getrennten lokalen Inhalte-Repositorys aus reinen Beispieldaten.
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.private-repository');
const file = resolve(target, 'doors-data.json');
let exists = true;
try { await access(file); } catch { exists = false; }
if (exists) { console.log('Privates Inhalte-Verzeichnis bereits vorhanden; es wurde nichts überschrieben.'); }
else {
  const data = JSON.parse(await readFile(resolve(root, 'examples/doors-data.example.json'), 'utf8'));
  await mkdir(resolve(target, 'images'), { recursive: true });
  await mkdir(resolve(target, '.github/workflows'), { recursive: true });
  for (const door of data.doors) {
    const name = `day-${String(door.day).padStart(2, '0')}.svg`;
    await copyFile(resolve(root, 'assets/doors', name), resolve(target, 'images', name));
    door.image = `./images/${name}`;
  }
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  await copyFile(resolve(root, 'templates/private-repository/publish-calendar.yml'), resolve(target, '.github/workflows/publish-calendar.yml'));
  await writeFile(resolve(target, '.gitignore'), '.env\n*.key\n*.pem\n');
  await writeFile(resolve(target, 'README.md'), '# CreeUnity Adventskalender 2026 – private Inhalte\n\nDieses Repository muss privat bleiben. Vollständige Texte, Bilder und Links nur hier ablegen.\n\n`doors-data.json` enthält alle 24 Tage. Lokale Bilder liegen unter `images/`. Eine GitHub Action veröffentlicht ausschließlich bereits freigegebene Tage auf der öffentlichen Website. Erster geplanter Lauf im Dezember: 00:03 Uhr Europe/Berlin; Verzögerungen durch GitHub sind möglich.\n\nEin Schreib-Deploy-Key zum öffentlichen Website-Repository muss als Actions-Secret `WEBSITE_DEPLOY_KEY` hinterlegt sein. Ohne dieses Secret scheitert die Veröffentlichung sicher. Nach Änderungen kann die Action auch manuell unter Actions gestartet werden. Kein Testdatum ist im Workflow einstellbar.\n\nDie initialen Grafiken sind austauschbare Beispiele. Vor dem Start echte Tagesinhalte einpflegen. Bereits veröffentlichte Inhalte bleiben auch in der öffentlichen Git-Historie sichtbar.\n');
  console.log('Privates Inhalte-Verzeichnis mit Beispielen vorbereitet.');
}
