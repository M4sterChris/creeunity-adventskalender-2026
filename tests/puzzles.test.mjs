import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizePuzzleAnswer, validatePuzzle, puzzleIdentity, checkPuzzleAnswer } from '../puzzles.js';
import { validateConfig } from '../script.js';
import { selectReleasedContents } from '../tools/publish-doors.mjs';

const example = JSON.parse(await readFile(new URL('../examples/doors-data.example.json', import.meta.url), 'utf8'));
function source() {
  const config = structuredClone(example);
  config.doors[0].puzzle = { type: 'number', answer: '042', fragment: 'FRO' };
  config.doors[1].puzzle = { type: 'letters', answer: 'HE' };
  return config;
}

test('Zahlen werden ohne Rundungsfehler und mit Dezimalkomma verglichen', () => {
  for (const value of ['42', '0042', '+42', '42,00', '42.0']) assert.equal(normalizePuzzleAnswer(value, 'number'), '42');
  assert.equal(normalizePuzzleAnswer('-000.00', 'number'), '0');
  assert.equal(normalizePuzzleAnswer('00000000012345678901234567890', 'number'), '12345678901234567890');
  for (const value of ['', ' ', '4a', '1e2', 'Infinity', '4 2', null]) assert.equal(normalizePuzzleAnswer(value, 'number'), '');
});
test('Buchstabenfolgen ignorieren Großschreibung und Leerzeichen, aber keine falschen Zeichen', () => {
  assert.equal(normalizePuzzleAnswer(' h E \n', 'letters'), 'HE');
  assert.equal(normalizePuzzleAnswer(' e\u0301 ', 'letters'), 'É');
  assert.notEqual(normalizePuzzleAnswer('HA', 'letters'), 'HE');
  assert.equal(normalizePuzzleAnswer('ß'.repeat(120), 'letters'), '');
});
test('Rätsel sind optional und alte Kalender bleiben unverändert gültig', () => {
  assert.equal(validatePuzzle(undefined), undefined);
  assert.ok(validateConfig(example).doors.every(door => !door.puzzle));
  assert.equal(validateConfig(source()).doors[0].puzzle.fragment, 'FRO');
});
test('Unvollständige, ungültige und mehrdeutige Rätsel werden abgewiesen', () => {
  for (const value of [{}, [], { type: 'number', answer: 'x', fragment: 'A' }, { type: 'number', answer: '1' }, { type: 'letters', answer: '' }, { type: 'letters', answerHash: 'oops' }, { type: 'letters', answer: 'A', answerHash: 'a'.repeat(64) }]) assert.throws(() => validatePuzzle(value));
  const bad = source(); bad.doors[0].puzzle.fragment = '';
  assert.throws(() => validateConfig(bad), /Türchen 1/);
});
test('Zahl gibt die Buchstabenfolge erst nach richtiger Eingabe zurück', async () => {
  const puzzle = source().doors[0].puzzle;
  assert.deepEqual(await checkPuzzleAnswer(puzzle, '41', 2026, 1), { correct: false, fragment: '' });
  assert.deepEqual(await checkPuzzleAnswer(puzzle, '42,00', 2026, 1), { correct: true, fragment: 'FRO' });
});
test('Buchstabenprüfung gibt den richtigen eingegebenen Hinweis zurück', async () => {
  const puzzle = source().doors[1].puzzle;
  assert.deepEqual(await checkPuzzleAnswer(puzzle, ' h e ', 2026, 2), { correct: true, fragment: 'HE' });
  assert.deepEqual(await checkPuzzleAnswer(puzzle, 'HA', 2026, 2), { correct: false, fragment: '' });
});
test('Vor Freigabe werden weder Lösung, Prüfwert noch Belohnung veröffentlicht', () => {
  const config = source();
  const output = selectReleasedContents(config, new Date('2026-11-30T22:59:59Z'));
  assert.ok(output.doors.every(door => !Object.hasOwn(door, 'puzzle')));
  assert.doesNotMatch(JSON.stringify(output), /answer|fragment|FRO|answerHash/);
});
test('Am ersten Tag erscheint nur dessen Prüfwert, nicht die Klartextlösung', async () => {
  const output = selectReleasedContents(source(), new Date('2026-11-30T23:00:00Z'));
  const puzzle = output.doors[0].puzzle;
  assert.match(puzzle.answerHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(puzzle, 'answer'), false);
  assert.equal(output.doors[1].puzzle, undefined);
  assert.deepEqual(await checkPuzzleAnswer(puzzle, '42', 2026, 1), { correct: true, fragment: 'FRO' });
  assert.equal((await checkPuzzleAnswer(puzzle, '42', 2026, 2)).correct, false);
  assert.equal((await checkPuzzleAnswer(puzzle, '42', 2027, 1)).correct, false);
});
test('Veröffentlichte Buchstabenprüfungen enthalten keine Klartext-Buchstabenfolge', async () => {
  const output = selectReleasedContents(source(), new Date('2026-12-01T23:00:00Z'));
  const puzzle = output.doors[1].puzzle;
  assert.deepEqual(Object.keys(puzzle).sort(), ['answerHash', 'type']);
  assert.equal((await checkPuzzleAnswer(puzzle, ' h e ', 2026, 2)).correct, true);
  assert.equal((await checkPuzzleAnswer(puzzle, 'X', 2026, 2)).correct, false);
  assert.equal(validateConfig(output).doors[1].puzzle.answerHash, puzzle.answerHash);
});
test('Rätsel-Prüfwerte bleiben bei erneutem Publizieren unverändert', () => {
  const now = new Date('2026-12-24T12:00:00Z');
  assert.deepEqual(selectReleasedContents(source(), now), selectReleasedContents(source(), now));
});
test('Geänderte Antworten oder Belohnungen machen alte gelöste Zustände ungültig', () => {
  const puzzle = source().doors[0].puzzle;
  assert.notEqual(puzzleIdentity(puzzle), puzzleIdentity({ ...puzzle, answer: '43' }));
  assert.notEqual(puzzleIdentity(puzzle), puzzleIdentity({ ...puzzle, fragment: 'NEU' }));
  assert.equal(puzzleIdentity(puzzle), puzzleIdentity({ ...puzzle, answer: '00042.0' }));
});
