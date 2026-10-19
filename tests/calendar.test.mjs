import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getBerlinDateParts, isDoorUnlocked, validateConfig, safeUrl } from '../script.js';

const config = JSON.parse(await readFile(new URL('../examples/doors-data.example.json', import.meta.url), 'utf8'));

test('Berliner Tag wechselt im Winter um 23:00 UTC', () => {
  assert.deepEqual(getBerlinDateParts(new Date('2026-11-30T22:59:59Z')), { day: 30, month: 11, year: 2026 });
  assert.deepEqual(getBerlinDateParts(new Date('2026-11-30T23:00:00Z')), { day: 1, month: 12, year: 2026 });
});
test('Europe/Berlin berücksichtigt die Sommerzeit', () => {
  assert.deepEqual(getBerlinDateParts(new Date('2026-06-01T22:30:00Z')), { day: 2, month: 6, year: 2026 });
});
test('Türchen 1 öffnet exakt am 1. Dezember um 00:00 Berlin', () => {
  assert.equal(isDoorUnlocked(1, 2026, new Date('2026-11-30T22:59:59Z')), false);
  assert.equal(isDoorUnlocked(1, 2026, new Date('2026-11-30T23:00:00Z')), true);
  assert.equal(isDoorUnlocked(2, 2026, new Date('2026-11-30T23:00:00Z')), false);
});
test('Vergangene Tage bleiben erreichbar; zukünftige bleiben geschlossen', () => {
  const date = new Date('2026-12-12T12:00:00Z');
  for (let day = 1; day <= 24; day++) assert.equal(isDoorUnlocked(day, 2026, date), day <= 12);
  assert.equal(isDoorUnlocked(24, 2026, new Date('2026-12-23T22:59:59Z')), false);
  assert.equal(isDoorUnlocked(24, 2026, new Date('2026-12-23T23:00:00Z')), true);
});
test('Kalenderjahr wird berücksichtigt, auch vor/nach Dezember', () => {
  assert.equal(isDoorUnlocked(1, 2026, new Date('2025-12-24T12:00:00Z')), false);
  assert.equal(isDoorUnlocked(1, 2026, new Date('2026-10-19T12:00:00Z')), false);
  assert.equal(isDoorUnlocked(24, 2026, new Date('2027-01-01T12:00:00Z')), true);
  for (const day of [0, 25, -1, 1.5, NaN]) assert.equal(isDoorUnlocked(day, 2026), false);
});
test('Alle 24 lokalen Beispielgrafiken existieren', async () => {
  const checked = validateConfig(config);
  assert.equal(checked.doors.length, 24);
  for (const door of checked.doors) {
    const image = await readFile(new URL(`../${door.image}`, import.meta.url), 'utf8');
    assert.match(image, /<svg/);
    assert.match(image, new RegExp(`Türchen ${door.day}`));
  }
});
test('Import weist fehlende und doppelte Türchen ab', () => {
  const missing = structuredClone(config); missing.doors.pop();
  assert.throws(() => validateConfig(missing), /24 Türchen/);
  const duplicate = structuredClone(config); duplicate.doors[0].day = 2;
  assert.throws(() => validateConfig(duplicate), /genau einmal/);
});
test('Import validiert Jahr, Texte und Bild-URLs', () => {
  for (const year of [2023, 2101, '2026', 2026.5]) assert.throws(() => validateConfig({ ...config, year }));
  const empty = structuredClone(config); empty.doors[0].title = ' ';
  assert.throws(() => validateConfig(empty), /Überschrift/);
  const image = structuredClone(config); image.doors[0].image = 'javascript:alert(1)';
  assert.throws(() => validateConfig(image), /Bildpfad/);
});
test('Links und Bildpfade lassen keine aktiven URL-Schemas zu', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///secret', 'http://example.com/image.png']) {
    assert.equal(safeUrl(value, { image: true }), '');
  }
  assert.equal(safeUrl('./assets/test.png', { image: true }), './assets/test.png');
  assert.equal(safeUrl('https://example.com/image.png', { image: true }), 'https://example.com/image.png');
  assert.equal(safeUrl('https://user:pass@example.com'), '');
  assert.equal(safeUrl('relative-link'), '');
});
