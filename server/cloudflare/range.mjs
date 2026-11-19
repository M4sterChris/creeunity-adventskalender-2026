import { byteRange } from '../../tools/byte-range.mjs';

// Asset bindings can return a full response even when the client requested a
// range. Slice the stream without buffering an entire MP3 in Worker memory.
export async function rangedAsset(request, response, knownSize) {
  if (response.status !== 200 || !request.headers.has('Range')) return response;
  const sizeHeader = response.headers.get('Content-Length');
  const size = sizeHeader === null ? knownSize : Number(sizeHeader);
  if (!Number.isSafeInteger(size) || size < 0) return response;
  const range = byteRange(request.headers.get('Range'), size);
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (range === false) {
    await response.body?.cancel();
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Content-Length', String(range.end - range.start + 1));
  if (request.method === 'HEAD' || !response.body) return new Response(null, { status: 206, headers });
  const reader = response.body.getReader();
  let offset = 0;
  let finished = false;
  const body = new ReadableStream({
    async pull(controller) {
      if (finished) return;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { finished = true; controller.close(); return; }
          const from = Math.max(0, range.start - offset);
          const to = Math.min(value.byteLength, range.end + 1 - offset);
          offset += value.byteLength;
          if (to > from) controller.enqueue(value.slice(from, to));
          if (offset > range.end) { finished = true; controller.close(); await reader.cancel(); return; }
          if (to > from) return;
        }
      } catch (error) { finished = true; controller.error(error); }
    },
    async cancel(reason) { finished = true; await reader.cancel(reason); },
  });
  return new Response(body, { status: 206, headers });
}
