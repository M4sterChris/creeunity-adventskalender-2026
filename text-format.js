/* Kleine, bewusst begrenzte Textauszeichnung ohne HTML-Ausführung oder externe Bibliotheken.
 * Der Parser erstellt Daten; der Renderer erzeugt ausschließlich erlaubte DOM-Elemente.
 * CreeUnity-Kurzschrift: *fett*, _kursiv_, __unterstrichen__; **fett** funktioniert ebenfalls.
 */
export function safeTextLink(value) {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020<>"']/.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.username || url.password) return '';
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return '';
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

const markers = [
  ['***', 'strong-em'], ['___', 'u-em'], ['**', 'strong'], ['__', 'u'],
  ['~~', 's'], ['==', 'mark'], ['||', 'spoiler'], ['*', 'strong'], ['_', 'em'], ['^', 'sup'], ['~', 'sub'],
];
function closingMarker(text, marker, from) {
  let position = text.indexOf(marker, from);
  while (position >= 0) {
    let slashes = 0;
    for (let i = position - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
    if (!(slashes % 2)) return position;
    position = text.indexOf(marker, position + marker.length);
  }
  return -1;
}

export function parseInline(text, depth = 0, links = true) {
  if (depth > 12) return [{ text }];
  const result = [];
  let plain = '';
  const flush = () => { if (plain) { result.push({ text: plain }); plain = ''; } };
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && i + 1 < text.length && /[\\*_~^=|`\[\]()>#!+-]/.test(text[i + 1])) {
      plain += text[i + 1]; i += 2; continue;
    }
    if (text[i] === '\n') { flush(); result.push({ tag: 'br' }); i++; continue; }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) { flush(); result.push({ tag: 'code', children: [{ text: text.slice(i + 1, end) }] }); i = end + 1; continue; }
    }
    if (links && text[i] === '[') {
      const labelEnd = text.indexOf('](', i + 1);
      if (labelEnd > i + 1 && !text.slice(i, labelEnd).includes('\n')) {
        let level = 1; let end = labelEnd + 2;
        for (; end < text.length && level; end++) {
          if (text[end] === '(') level++;
          if (text[end] === ')') level--;
        }
        if (!level) {
          const href = safeTextLink(text.slice(labelEnd + 2, end - 1));
          if (href) { flush(); result.push({ tag: 'a', href, children: parseInline(text.slice(i + 1, labelEnd), depth + 1, false) }); i = end; continue; }
        }
      }
    }
    const color = text.slice(i).match(/^\[color=(green|gold|red|blue|purple)\]([\s\S]+?)\[\/color\]/);
    if (color) { flush(); result.push({ tag: 'color', color: color[1], children: parseInline(color[2], depth + 1, links) }); i += color[0].length; continue; }
    if (links && /^https?:\/\//i.test(text.slice(i))) {
      const match = text.slice(i).match(/^https?:\/\/[^\s<>"']+/i);
      let raw = match?.[0] || '';
      raw = raw.replace(/[.,;!?]+$/, '');
      while (raw.endsWith(')') && (raw.match(/\)/g)?.length || 0) > (raw.match(/\(/g)?.length || 0)) raw = raw.slice(0, -1);
      raw = raw.replace(/\]+$/, '');
      const href = safeTextLink(raw);
      if (href) { flush(); result.push({ tag: 'a', href, children: [{ text: raw }] }); i += raw.length; continue; }
    }
    let matched = false;
    for (const [marker, tag] of markers) {
      if (!text.startsWith(marker, i)) continue;
      // Unterstriche in Dateinamen und Wörtern bleiben unverändert.
      if (marker === '_' && /[\p{L}\p{N}]/u.test(text[i - 1] || '') && /[\p{L}\p{N}]/u.test(text[i + 1] || '')) continue;
      const end = closingMarker(text, marker, i + marker.length);
      const content = end < 0 ? '' : text.slice(i + marker.length, end);
      if (!content || /^\s|\s$/.test(content)) continue;
      flush();
      const children = parseInline(content, depth + 1, links);
      result.push(tag === 'strong-em' ? { tag: 'strong', children: [{ tag: 'em', children }] }
        : tag === 'u-em' ? { tag: 'u', children: [{ tag: 'em', children }] } : { tag, children });
      i = end + marker.length; matched = true; break;
    }
    if (!matched) { plain += text[i]; i++; }
  }
  flush();
  return result;
}

function listMarker(line) {
  const match = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  return { indent: match[1].length, ordered: /^\d/.test(match[2]), start: parseInt(match[2], 10) || 1, body: match[3] };
}
function tableCells(line) {
  let source = line.trim();
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);
  const cells = []; let current = ''; let code = false;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\' && source[i + 1] === '|') { current += '\\|'; i++; continue; }
    if (source[i] === '`') code = !code;
    if (source[i] === '|' && !code) { cells.push(current.trim()); current = ''; }
    else current += source[i];
  }
  cells.push(current.trim());
  return cells;
}
function tableStart(lines, i) {
  if (!lines[i]?.includes('|') || !lines[i + 1]?.includes('|')) return false;
  const header = tableCells(lines[i]); const separator = tableCells(lines[i + 1]);
  return header.length === separator.length && separator.every(cell => /^:?-{3,}:?$/.test(cell));
}
function beginsBlock(lines, i) {
  return /^\s*(?:#{1,3}\s|>|```|\[(?:center|left|right)\]\s*$)/.test(lines[i]) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) || Boolean(listMarker(lines[i])) || tableStart(lines, i);
}
function parseBlocks(lines, depth = 0) {
  if (depth > 12) return [{ tag: 'p', children: [{ text: lines.join('\n') }] }];
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    const fence = lines[i].match(/^\s*```([a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      const content = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) content.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ tag: 'pre', children: [{ tag: 'code', children: [{ text: content.join('\n') }] }] }); continue;
    }
    const alignment = lines[i].trim().match(/^\[(center|left|right)\]$/);
    if (alignment) {
      const end = lines.findIndex((line, index) => index > i && line.trim() === `[/${alignment[1]}]`);
      if (end >= 0) { blocks.push({ tag: 'align', align: alignment[1], children: parseBlocks(lines.slice(i + 1, end), depth + 1) }); i = end + 1; continue; }
    }
    const heading = lines[i].match(/^\s*(#{1,3})\s+(.+)$/);
    if (heading) { blocks.push({ tag: `h${heading[1].length + 2}`, children: parseInline(heading[2]) }); i++; continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) { blocks.push({ tag: 'hr' }); i++; continue; }
    if (/^\s*>/.test(lines[i])) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*> ?/, ''));
      blocks.push({ tag: 'blockquote', children: parseBlocks(quote, depth + 1) }); continue;
    }
    if (tableStart(lines, i)) {
      const header = tableCells(lines[i]); const separator = tableCells(lines[i + 1]);
      const align = separator.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
      const rows = []; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(tableCells(lines[i++]));
      blocks.push({ tag: 'table', header: header.map(cell => parseInline(cell)), align,
        rows: rows.map(row => header.map((_, index) => parseInline(row[index] || ''))) }); continue;
    }
    const first = listMarker(lines[i]);
    if (first) {
      const items = [];
      while (i < lines.length) {
        const item = listMarker(lines[i]);
        if (!item || item.indent !== first.indent || item.ordered !== first.ordered) break;
        let body = item.body;
        const task = body.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) body = task[2];
        const content = [body]; i++;
        while (i < lines.length && lines[i].trim() && (lines[i].match(/^\s*/)?.[0].length || 0) > first.indent) {
          content.push(lines[i++].slice(first.indent + 2));
        }
        items.push({ tag: 'li', ...(task ? { checked: task[1].toLowerCase() === 'x' } : {}), children: parseBlocks(content, depth + 1) });
      }
      blocks.push({ tag: first.ordered ? 'ol' : 'ul', start: first.start, children: items }); continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !beginsBlock(lines, i)) paragraph.push(lines[i++]);
    blocks.push({ tag: 'p', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

export function parseFormattedText(text) {
  if (typeof text !== 'string') return [];
  return parseBlocks(text.slice(0, 10000).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n'));
}

export function renderFormattedText(text, target) {
  const doc = target.ownerDocument;
  const allowed = new Set(['p', 'strong', 'em', 'u', 's', 'mark', 'sup', 'sub', 'code', 'pre', 'br', 'hr', 'h3', 'h4', 'h5', 'blockquote', 'ul', 'ol', 'li', 'a']);
  function append(parent, tokens) {
    for (const token of tokens) {
      if ('text' in token) { parent.append(doc.createTextNode(token.text)); continue; }
      if (token.tag === 'table') {
        const wrap = doc.createElement('div'); wrap.className = 'text-table-scroll'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Tabelle');
        const table = doc.createElement('table'); const head = doc.createElement('thead'); const body = doc.createElement('tbody');
        const row = doc.createElement('tr');
        token.header.forEach((children, index) => { const cell = doc.createElement('th'); cell.scope = 'col'; cell.style.textAlign = token.align[index]; append(cell, children); row.append(cell); });
        head.append(row);
        token.rows.forEach(cells => { const row = doc.createElement('tr'); cells.forEach((children, index) => { const cell = doc.createElement('td'); cell.style.textAlign = token.align[index]; append(cell, children); row.append(cell); }); body.append(row); });
        table.append(head, body); wrap.append(table); parent.append(wrap); continue;
      }
      if (token.tag === 'spoiler') {
        const control = doc.createElement('span'); control.className = 'text-spoiler'; control.tabIndex = 0; control.setAttribute('role', 'button'); control.setAttribute('aria-expanded', 'false'); control.setAttribute('aria-label', 'Verborgenen Text anzeigen');
        const content = doc.createElement('span'); content.className = 'text-spoiler-content'; content.inert = true; content.setAttribute('aria-hidden', 'true'); append(content, token.children);
        const toggle = () => { const open = control.getAttribute('aria-expanded') !== 'true'; control.setAttribute('aria-expanded', String(open)); control.setAttribute('aria-label', open ? 'Text wieder verbergen' : 'Verborgenen Text anzeigen'); content.inert = !open; content.setAttribute('aria-hidden', String(!open)); };
        control.addEventListener('click', event => { if (control.getAttribute('aria-expanded') === 'true' && event.target.closest('a')) return; toggle(); });
        control.addEventListener('keydown', event => { if (event.target === control && ['Enter', ' '].includes(event.key)) { event.preventDefault(); toggle(); } });
        control.append(content); parent.append(control); continue;
      }
      if (token.tag === 'align' || token.tag === 'color') {
        const element = doc.createElement(token.tag === 'align' ? 'div' : 'span');
        element.className = token.tag === 'align' ? `text-align-${token.align}` : `text-color-${token.color}`;
        append(element, token.children); parent.append(element); continue;
      }
      if (!allowed.has(token.tag)) continue;
      const element = doc.createElement(token.tag);
      if (token.tag === 'a') { element.href = token.href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
      if (token.tag === 'ol' && token.start !== 1) element.start = Math.min(token.start, 1000000);
      if (token.tag === 'li' && typeof token.checked === 'boolean') {
        element.className = 'text-task';
        const checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = token.checked; checkbox.disabled = true; checkbox.setAttribute('aria-label', token.checked ? 'Erledigt' : 'Offen'); element.append(checkbox);
      }
      if (token.children) append(element, token.children);
      parent.append(element);
    }
  }
  const fragment = doc.createDocumentFragment(); append(fragment, parseFormattedText(text)); target.replaceChildren(fragment);
}

/** Formatierungsschaltflächen arbeiten auf der Textauswahl; gespeichert bleibt normaler Text. */
export function formatSelection(value, action, start, end) {
  const chosen = value.slice(start, end);
  const inline = { bold: ['*', '*'], italic: ['_', '_'], underline: ['__', '__'], strike: ['~~', '~~'], highlight: ['==', '=='], spoiler: ['||', '||'], code: ['`', '`'], sub: ['~', '~'], sup: ['^', '^'] };
  let insertion; let selectionStart; let selectionEnd;
  if (inline[action]) {
    const [before, after] = inline[action]; const text = chosen || 'Text';
    if (chosen && value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
      return { value: value.slice(0, start - before.length) + chosen + value.slice(end + after.length), start: start - before.length, end: end - before.length };
    }
    if (chosen.startsWith(before) && chosen.endsWith(after) && chosen.length > before.length + after.length) {
      insertion = chosen.slice(before.length, -after.length); selectionStart = start; selectionEnd = start + insertion.length;
    } else { insertion = `${before}${text}${after}`; selectionStart = start + before.length; selectionEnd = selectionStart + text.length; }
  } else if (action === 'link') {
    const label = chosen || 'Linktext'; insertion = `[${label}](https://example.com)`;
    selectionStart = start + label.length + 3; selectionEnd = selectionStart + 'https://example.com'.length;
  } else if (action.startsWith('color-')) {
    const color = action.slice(6);
    if (!['green', 'gold', 'red', 'blue', 'purple'].includes(color)) return { value, start, end };
    insertion = `[color=${color}]${chosen || 'Text'}[/color]`; selectionStart = start + color.length + 8; selectionEnd = selectionStart + (chosen || 'Text').length;
  } else {
    const prefixes = { heading1: '# ', heading2: '## ', heading3: '### ', bullet: '- ', numbered: '1. ', task: '- [ ] ', quote: '> ' };
    if (prefixes[action]) {
      const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = value.indexOf('\n', end) < 0 ? value.length : value.indexOf('\n', end);
      const lines = value.slice(lineStart, lineEnd).split('\n');
      const formatted = lines.map((line, index) => `${action === 'numbered' ? `${index + 1}. ` : prefixes[action]}${line || 'Text'}`).join('\n');
      return { value: value.slice(0, lineStart) + formatted + value.slice(lineEnd), start: lineStart, end: lineStart + formatted.length };
    }
    const blocks = { codeblock: `\`\`\`\n${chosen || 'Dein Code'}\n\`\`\``, divider: '---', table: '| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Text | Text |', center: `[center]\n${chosen || 'Text'}\n[/center]`, right: `[right]\n${chosen || 'Text'}\n[/right]`, left: `[left]\n${chosen || 'Text'}\n[/left]` };
    if (!Object.hasOwn(blocks, action)) return { value, start, end };
    const before = start && value[start - 1] !== '\n' ? '\n\n' : '';
    const after = end < value.length && value[end] !== '\n' ? '\n\n' : '';
    insertion = before + blocks[action] + after; selectionStart = start + before.length; selectionEnd = selectionStart + blocks[action].length;
  }
  return { value: value.slice(0, start) + insertion + value.slice(end), start: selectionStart, end: selectionEnd };
}
