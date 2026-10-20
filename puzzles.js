/* Gemeinsame Rätselregeln für Editor, Browserprüfung und Tagesveröffentlichung. */
export function normalizePuzzleAnswer(value, type) {
  if (typeof value !== 'string' || value.length > 120) return '';
  const text = value.normalize('NFKC').trim();
  if (type === 'letters') { const result = text.replace(/\s/gu, '').toLocaleUpperCase('de-DE'); return result.length <= 120 ? result : ''; }
  if (type !== 'number' || !/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) return '';
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').replace(',', '.').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimal = fraction.replace(/0+$/, '');
  const sign = text.startsWith('-') && (integer !== '0' || decimal) ? '-' : '';
  return `${sign}${integer}${decimal ? `.${decimal}` : ''}`;
}

export function validatePuzzle(value) {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value) || !['number', 'letters'].includes(value.type)) throw new Error('Bitte einen gültigen Rätseltyp wählen.');
  const hasAnswer = typeof value.answer === 'string';
  const hasHash = typeof value.answerHash === 'string';
  if (hasAnswer === hasHash) throw new Error('Das Rätsel benötigt genau eine Lösung oder einen veröffentlichten Prüfwert.');
  if (hasAnswer && !normalizePuzzleAnswer(value.answer, value.type)) throw new Error('Bitte eine gültige Rätsellösung mit maximal 120 Zeichen eingeben.');
  if (hasHash && !/^[a-f0-9]{64}$/.test(value.answerHash)) throw new Error('Der veröffentlichte Rätsel-Prüfwert ist ungültig.');
  const result = { type: value.type, ...(hasAnswer ? { answer: value.answer.trim() } : { answerHash: value.answerHash }) };
  if (value.type === 'number') {
    if (typeof value.fragment !== 'string' || !value.fragment.trim() || value.fragment.length > 120) throw new Error('Für ein Zahlenrätsel bitte die freizugebende Buchstabenfolge eintragen (maximal 120 Zeichen).');
    result.fragment = value.fragment.trim();
  }
  return result;
}

// Tages- und Jahresbindung verhindert, dass derselbe Prüfwert mehrere Rätsel gleichsetzt.
export function puzzleHashInput(answer, type, year, day) {
  return JSON.stringify(['creeunity-puzzle-v1', year, day, type, normalizePuzzleAnswer(answer, type)]);
}

export function puzzleIdentity(puzzle) {
  return puzzle ? JSON.stringify([puzzle.type, puzzle.answerHash || normalizePuzzleAnswer(puzzle.answer, puzzle.type), puzzle.fragment || '']) : '';
}

export async function checkPuzzleAnswer(puzzle, input, year, day) {
  const answer = normalizePuzzleAnswer(input, puzzle.type);
  if (!answer) return { correct: false, fragment: '' };
  let correct;
  if (typeof puzzle.answer === 'string') {
    correct = answer === normalizePuzzleAnswer(puzzle.answer, puzzle.type);
  } else {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(puzzleHashInput(input, puzzle.type, year, day)));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    correct = hash === puzzle.answerHash;
  }
  return { correct, fragment: correct ? (puzzle.type === 'number' ? puzzle.fragment : answer) : '' };
}
