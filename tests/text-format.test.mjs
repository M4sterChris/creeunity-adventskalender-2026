import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFormattedText, parseInline, formatSelection, safeTextLink } from '../text-format.js';

function tags(tokens) {
  return tokens.flatMap(token => [token.tag, ...tags(token.children || []), ...tags(token.header?.flat() || []), ...tags(token.rows?.flat(2) || [])]).filter(Boolean);
}
function plain(tokens) { return tokens.map(token => token.text ?? plain(token.children || [])).join(''); }

test('Sternchen sind fett, Unterstriche kursiv/unterstrichen und kombinierbar', () => {
  const nodes = parseInline('*fett* **auch fett** _kursiv_ __unter__ ***beides***');
  assert.deepEqual(tags(nodes), ['strong', 'strong', 'em', 'u', 'strong', 'em']);
  assert.equal(plain(nodes), 'fett auch fett kursiv unter beides');
  assert.deepEqual(tags(parseInline('*fett _und kursiv_*')), ['strong', 'em']);
});
test('Weitere Inline-Formate werden erkannt', () => {
  assert.deepEqual(tags(parseInline('~~weg~~ ==markiert== ||Spoiler|| ~tief~ ^hoch^')), ['s', 'mark', 'spoiler', 'sub', 'sup']);
});
test('Backslash und Code schützen Formatierungszeichen vor Interpretation', () => {
  assert.equal(plain(parseInline('\\*normal\\*')), '*normal*');
  const code = parseInline('`*kein fett* <script>`');
  assert.deepEqual(tags(code), ['code']);
  assert.equal(plain(code), '*kein fett* <script>');
  assert.equal(plain(parseInline('datei_name_bild.png')), 'datei_name_bild.png');
});
test('Offene Marker und unformatierter Text bleiben erhalten', () => {
  assert.equal(plain(parseInline('Hallo *Welt')), 'Hallo *Welt');
  assert.equal(plain(parseInline('2 * 3 * 4')), '2 * 3 * 4');
  assert.equal(plain(parseInline('M4sterCree & die CreeUnity 🎄')), 'M4sterCree & die CreeUnity 🎄');
});
test('Beschriftete Links und automatische URLs behalten sichere Zieladressen', () => {
  const [link] = parseInline('[Zum *Stream*](https://www.twitch.tv/m4stercree)');
  assert.equal(link.tag, 'a'); assert.equal(link.href, 'https://www.twitch.tv/m4stercree');
  assert.deepEqual(tags(link.children), ['strong']);
  const nodes = parseInline('(https://example.com/test_(abc)).');
  assert.equal(nodes.find(node => node.tag === 'a').href, 'https://example.com/test_(abc)');
  assert.equal(plain(nodes), '(https://example.com/test_(abc)).');
});
test('Aktive Schemas, Credentials und eingeschleuste HTML-Attribute sind kein Link', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'https://u:p@example.com', 'https://example.com\nonclick=x', 'https://example.com"onclick=x', 'http://example.com']) assert.equal(safeTextLink(value), '');
  assert.ok(!tags(parseFormattedText('[klick](javascript:alert(1))')).includes('a'));
});
test('HTML bleibt normaler Text, auch in Tabellen und Farben', () => {
  const nodes = parseFormattedText('<script>alert(1)</script>\n\n[color=red onclick=x]Test[/color]\n\n| A | B |\n| --- | --- |\n| <img src=x onerror=alert(1)> | OK |');
  assert.ok(!tags(nodes).some(tag => ['script', 'img', 'iframe', 'style'].includes(tag)));
  assert.match(JSON.stringify(nodes), /<script>/);
  assert.ok(!tags(nodes).includes('color'));
});
test('Überschriften, Absätze, Umbrüche, Zitate und Trennlinien', () => {
  const nodes = parseFormattedText('# Groß\n## Mittel\n### Klein\n\nZeile 1\nZeile 2\n\n> Ein Zitat\n> Weiter\n\n---');
  assert.deepEqual(nodes.map(node => node.tag), ['h3', 'h4', 'h5', 'p', 'blockquote', 'hr']);
  assert.ok(tags(nodes).includes('br'));
});
test('Listen sind verschachtelbar und Checklisten behalten den Zustand', () => {
  const nodes = parseFormattedText('- Hauptpunkt\n  - Unterpunkt\n- [x] Fertig\n- [ ] Offen\n\n3. Drittens\n4. Viertens');
  assert.equal(nodes[0].tag, 'ul'); assert.ok(tags(nodes[0].children[0].children).includes('ul'));
  assert.equal(nodes[0].children[1].checked, true); assert.equal(nodes[0].children[2].checked, false);
  assert.equal(nodes[1].tag, 'ol'); assert.equal(nodes[1].start, 3);
});
test('Codeblöcke führen kein HTML oder Inline-Formatierung aus', () => {
  const [node] = parseFormattedText('```html\n<script>alert(1)</script>\n*normal*\n```');
  assert.deepEqual(tags([node]), ['pre', 'code']);
  assert.equal(plain([node]), '<script>alert(1)</script>\n*normal*');
});
test('Tabellen unterstützen Ausrichtung, Formatierung und geschützte Pipe-Zeichen', () => {
  const [table] = parseFormattedText('| *Name* | Zahl |\n| :--- | ---: |\n| A\\|B | 12 |');
  assert.equal(table.tag, 'table'); assert.deepEqual(table.align, ['left', 'right']);
  assert.deepEqual(tags(table.header[0]), ['strong']); assert.equal(plain(table.rows[0][0]), 'A|B');
});
test('Ausrichtung und feste Farben akzeptieren keine freien HTML-/CSS-Werte', () => {
  const nodes = parseFormattedText('[center]\n[color=gold]*Gold*[/color]\n[/center]');
  assert.equal(nodes[0].tag, 'align'); assert.equal(nodes[0].align, 'center');
  assert.deepEqual(tags(nodes), ['align', 'p', 'color', 'strong']);
  assert.ok(!tags(parseFormattedText('[color=url(javascript:1)]Test[/color]')).includes('color'));
});
test('Toolbar umschließt Auswahl, entfernt vorhandene Marker und markiert Linkziel', () => {
  assert.deepEqual(formatSelection('Hallo Welt', 'bold', 6, 10), { value: 'Hallo *Welt*', start: 7, end: 11 });
  assert.deepEqual(formatSelection('Hallo *Welt*', 'bold', 7, 11), { value: 'Hallo Welt', start: 6, end: 10 });
  const link = formatSelection('Stream', 'link', 0, 6);
  assert.equal(link.value.slice(link.start, link.end), 'https://example.com');
  const color = formatSelection('Gold', 'color-gold', 0, 4);
  assert.equal(color.value.slice(color.start, color.end), 'Gold');
});
test('Toolbar fügt vollständige Zeilen und Blockvorlagen ein', () => {
  assert.equal(formatSelection('Eins\nZwei', 'numbered', 0, 9).value, '1. Eins\n2. Zwei');
  for (const action of ['heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'task', 'quote', 'table', 'codeblock', 'divider', 'center', 'right', 'left']) {
    const result = formatSelection('', action, 0, 0);
    assert.ok(result.value.length); assert.ok(parseFormattedText(result.value).length);
  }
  assert.equal(formatSelection('Text', 'unknown', 0, 4).value, 'Text');
});
