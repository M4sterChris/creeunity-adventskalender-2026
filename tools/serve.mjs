// Kleiner lokaler Entwicklungsserver ohne npm-Abhängigkeiten. Nicht zum Hosting nötig.
import { createServer } from 'node:http';
import { resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendFile } from './send-file.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const privatePreview = process.argv.includes('--private');
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // Auch lokal keine .git-, Token- oder privaten Quelldateien über beliebige Pfade ausliefern.
    let path;
    if (privatePreview && pathname === '/doors-data.json') path = resolve(root, '.private-repository/doors-data.json');
    else if (privatePreview && /^\/(?:images|audio)\/[a-zA-Z0-9_./-]+$/.test(pathname) && !pathname.split('/').includes('..')) {
      path = resolve(root, '.private-repository', `.${pathname}`);
    } else if (['/', '/index.html', '/styles.css', '/script.js', '/theme.js', '/github-editor.js', '/text-format.js', '/puzzles.js', '/puzzle-client.js', '/media.js', '/doors-data.json'].includes(pathname) ||
      (/^\/assets\/[a-zA-Z0-9_./-]+$/.test(pathname) && !pathname.split('/').includes('..'))) {
      path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    } else { response.writeHead(404).end('Not found'); return; }
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end('Forbidden'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end('Method not allowed'); return; }
    await sendFile(request, response, path, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`CreeUnity ${privatePreview ? 'PRIVATE ' : ''}Vorschau: http://127.0.0.1:${port}${privatePreview ? '/?admin=true' : '/'}`));
