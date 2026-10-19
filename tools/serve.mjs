// Kleiner lokaler Entwicklungsserver ohne npm-Abhängigkeiten. Nicht zum Hosting nötig.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const port = Number(process.env.PORT || 4173);
const privatePreview = process.argv.includes('--private');
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // Auch lokal keine .git-, Token- oder privaten Quelldateien über beliebige Pfade ausliefern.
    let path;
    if (privatePreview && pathname === '/doors-data.json') path = resolve(root, '.private-repository/doors-data.json');
    else if (privatePreview && /^\/images\/[a-zA-Z0-9_./-]+$/.test(pathname) && !pathname.split('/').includes('..')) {
      path = resolve(root, '.private-repository', `.${pathname}`);
    } else if (['/', '/index.html', '/styles.css', '/script.js', '/doors-data.json'].includes(pathname) ||
      (/^\/assets\/[a-zA-Z0-9_./-]+$/.test(pathname) && !pathname.split('/').includes('..'))) {
      path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    } else { response.writeHead(404).end('Not found'); return; }
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end('Forbidden'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end('Method not allowed'); return; }
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`CreeUnity ${privatePreview ? 'PRIVATE ' : ''}Vorschau: http://127.0.0.1:${port}${privatePreview ? '/?admin=true' : '/'}`));
