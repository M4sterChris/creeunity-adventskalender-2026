import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { extname } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg' };

export function byteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return false;
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return false; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start ? { start, end } : false;
}

/** Call only after the caller has checked the path and calendar release date. */
export async function sendFile(request, response, path, headers = {}) {
  const info = await stat(path);
  if (!info.isFile()) { const error = new Error('Not found'); error.code = 'ENOENT'; throw error; }
  const range = byteRange(request.headers.range, info.size);
  const common = { ...headers, 'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (range === false) { response.writeHead(416, { ...common, 'Content-Range': `bytes */${info.size}`, 'Content-Length': 0 }).end(); return; }
  const start = range?.start ?? 0, end = range?.end ?? info.size - 1;
  response.writeHead(range ? 206 : 200, { ...common, 'Content-Length': range ? end - start + 1 : info.size, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
  if (request.method === 'HEAD' || info.size === 0) { response.end(); return; }
  try { await pipeline(createReadStream(path, { start, end }), response); }
  catch (error) { if (!['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET'].includes(error.code)) throw error; }
}
