import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { selectReleasedContents, publishDoors, localImagePath } from '../tools/publish-doors.mjs';

const example = JSON.parse(await readFile(new URL('../examples/doors-data.example.json', import.meta.url), 'utf8'));
const privateData = () => ({ ...structuredClone(example), doors: example.doors.map(door => ({ ...door,
  title: `GEHEIM-TITEL-${door.day}`, text: `GEHEIM-TEXT-${door.day}`, alt: `GEHEIM-ALT-${door.day}`, image: `./images/geheim-${door.day}.svg`,
  puzzle: door.day % 2 ? { type: 'number', answer: String(door.day), fragment: `GEHEIM-BUCHSTABEN-${door.day}` } : { type: 'letters', answer: `GEHEIM-LOESUNG-${door.day}` },
})) });

test('Vor dem 1. Dezember werden keinerlei private Inhalte exportiert', () => {
  const output = selectReleasedContents(privateData(), new Date('2026-11-30T22:59:59Z'));
  assert.equal(output.doors.filter(d => d.released).length, 0);
  assert.doesNotMatch(JSON.stringify(output), /GEHEIM|geheim|images\//);
});
test('Ab Berliner Mitternacht wird ausschließlich der richtige Tag exportiert', () => {
  const output = selectReleasedContents(privateData(), new Date('2026-11-30T23:00:00Z'));
  assert.equal(output.doors[0].released, true);
  assert.equal(output.doors[0].text, 'GEHEIM-TEXT-1');
  for (const door of output.doors.slice(1)) {
    assert.equal(door.released, false);
    assert.doesNotMatch(JSON.stringify(door), /GEHEIM|geheim/);
  }
});

test('Alle 24 Berliner Tageswechsel geben genau die bis dahin fälligen Inhalte frei', () => {
  const input = privateData();
  for (let day = 1; day <= 24; day++) {
    // Dezember in Berlin ist UTC+1; der Tag beginnt am Vortag um 23:00 UTC.
    const midnight = Date.UTC(2026, 11, day) - 60 * 60 * 1000;
    for (const [offset, expected] of [[-1, day - 1], [0, day]]) {
      const output = selectReleasedContents(input, new Date(midnight + offset));
      assert.equal(output.doors.filter(door => door.released).length, expected, `Tag ${day}, Offset ${offset}`);
      for (const door of output.doors.filter(door => !door.released)) {
        assert.doesNotMatch(JSON.stringify(door), /GEHEIM|geheim|images\//, `Türchen ${door.day} bleibt privat`);
      }
    }
  }
});
test('Verspätete Actions holen alle bisherigen Tage nach', () => {
  const output = selectReleasedContents(privateData(), new Date('2026-12-07T02:17:00Z'));
  assert.equal(output.doors.filter(d => d.released).length, 7);
  assert.equal(selectReleasedContents(privateData(), new Date('2027-01-01T00:00:00Z')).doors.filter(d => d.released).length, 24);
});
test('Private Metadaten werden auch über zusätzliche JSON-Felder nicht kopiert', () => {
  const data = privateData(); data.adminToken = 'SECRET-TOKEN'; data.doors[0].note = 'SECRET-NOTE';
  assert.doesNotMatch(JSON.stringify(selectReleasedContents(data, new Date('2026-12-02T12:00:00Z'))), /SECRET/);
});
test('Lokale Bildpfade dürfen den privaten Bilderordner nicht verlassen', () => {
  for (const path of ['../secret.png', './images/../secret.png', '/images/test.png', 'C:/secret.png', './images/a\\b.png', './images/a.html']) assert.throws(() => localImagePath(path));
  assert.equal(localImagePath('./images/door-1.png'), 'images/door-1.png');
});

async function fixture(t) {
  const qaRoot = resolve('.qa'); await mkdir(qaRoot, { recursive: true });
  const root = await mkdtemp(resolve(qaRoot, 'publication-test-'));
  t.after(async () => {
    // Rekursives Entfernen ist strikt auf das für diesen Test erzeugte Verzeichnis begrenzt.
    if (!root.startsWith(`${qaRoot}${sep}`)) throw new Error('Ungültiges Testverzeichnis');
    await rm(root, { recursive: true, force: true });
  });
  const source = resolve(root, 'private'); const target = resolve(root, 'public');
  await mkdir(resolve(source, 'images'), { recursive: true }); await mkdir(target);
  await writeFile(resolve(source, 'doors-data.json'), JSON.stringify(privateData()));
  return { root, source, target };
}
test('Publisher kopiert ausschließlich freigegebene Bilder und ist wiederholbar', async t => {
  const { source, target } = await fixture(t);
  // Für zukünftige Tage existieren bewusst gar keine Bilder.
  await writeFile(resolve(source, 'images/geheim-1.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><title>Tag 1</title></svg>');
  const now = new Date('2026-12-01T00:00:00Z');
  const first = await publishDoors({ source, target, now });
  assert.equal(first.released, 1); assert.equal(first.changed, true);
  const manifest = JSON.parse(await readFile(resolve(target, 'doors-data.json'), 'utf8'));
  assert.match(manifest.doors[0].image, /assets\/released\/2026\/day-01-[a-f0-9]+\.svg/);
  assert.equal((await readdir(resolve(target, 'assets/released/2026'))).length, 1);
  assert.doesNotMatch(JSON.stringify(manifest.doors.slice(1)), /GEHEIM|geheim/);
  assert.equal((await publishDoors({ source, target, now })).changed, false);
});

test('Datei-Probelauf über den Dezember veröffentlicht weder Texte noch Bilddateien vorzeitig', async t => {
  const { source, target } = await fixture(t);
  for (let day = 1; day <= 24; day++) {
    await writeFile(resolve(source, `images/geheim-${day}.svg`), `<svg xmlns="http://www.w3.org/2000/svg"><title>PRIVATE-BILD-${day}-ENDE</title></svg>`);
  }
  const cases = [
    ['2026-11-30T22:59:59.999Z', 0],
    ['2026-11-30T23:00:00.000Z', 1],
    ['2026-12-01T22:59:59.999Z', 1],
    ['2026-12-01T23:00:00.000Z', 2],
    ['2026-12-12T03:17:00.000Z', 12],
    ['2026-12-23T22:59:59.999Z', 23],
    ['2026-12-23T23:00:00.000Z', 24],
  ];
  for (const [date, expected] of cases) {
    const result = await publishDoors({ source, target, now: new Date(date) });
    assert.equal(result.released, expected);
    const manifest = JSON.parse(await readFile(resolve(target, 'doors-data.json'), 'utf8'));
    const imageFolder = resolve(target, 'assets/released/2026');
    let images = [];
    try { images = await readdir(imageFolder); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(images.length, expected, `Bilddateien am ${date}`);
    for (let day = 1; day <= 24; day++) {
      const door = manifest.doors[day - 1];
      assert.equal(door.released, day <= expected);
      if (day <= expected) {
        assert.equal(door.title, `GEHEIM-TITEL-${day}`);
        const bytes = await readFile(resolve(target, door.image), 'utf8');
        assert.ok(bytes.includes(`PRIVATE-BILD-${day}-ENDE`));
      } else {
        assert.equal(door.text, '');
        assert.equal(door.image, './assets/placeholder.svg');
        assert.ok(!images.some(name => name.startsWith(`day-${String(day).padStart(2, '0')}-`)));
        assert.doesNotMatch(JSON.stringify(door), /GEHEIM|geheim/);
      }
    }
  }
});
test('Publisher schreibt bei fehlendem heutigen Bild keine neue Kalenderdatei', async t => {
  const { source, target } = await fixture(t);
  await assert.rejects(() => publishDoors({ source, target, now: new Date('2026-12-01T00:00:00Z') }));
  assert.deepEqual(await readdir(target), []);
});
test('Nach dem Jahreswechsel im neuen Kalenderjahr bleibt alles gesperrt', () => {
  const data = privateData(); data.year = 2027;
  const result = selectReleasedContents(data, new Date('2027-01-01T00:00:00Z'));
  assert.equal(result.doors.filter(door => door.released).length, 0);
});
test('Öffentliche Produktionsdatei enthält explizite Veröffentlichungsangaben', async () => {
  const data = JSON.parse(await readFile(new URL('../doors-data.json', import.meta.url), 'utf8'));
  assert.equal(data.releaseMode, 'daily');
  assert.equal(data.doors.length, 24);
  assert.ok(data.doors.every(door => typeof door.released === 'boolean'));
  for (const door of data.doors.filter(door => !door.released)) {
    assert.equal(door.text, ''); assert.equal(door.image, './assets/placeholder.svg');
  }
});
