export const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
export const AUDIO_TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg' };

export function audioMime(value) {
  try { return AUDIO_TYPES[new URL(value, 'https://calendar.invalid/').pathname.split('.').pop().toLowerCase()] || ''; }
  catch { return ''; }
}

export function safeAudioUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  try {
    const url = new URL(raw, 'https://calendar.invalid/');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return '';
    return audioMime(raw) ? raw : '';
  } catch { return ''; }
}

export function privateAudioPath(value) {
  const path = String(value).replace(/^\.\//, '');
  if (!/^audio\/[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').some(p => ['..', '.', ''].includes(p)) || !audioMime(path)) {
    throw new Error('Bitte eine MP3-, WAV-, M4A- oder Ogg-Datei aus dem privaten audio/-Ordner verwenden.');
  }
  return path;
}

export function detectAudio(bytes) {
  if (bytes.length < 12 || bytes.length > MAX_AUDIO_SIZE) throw new Error('Bitte eine Audiodatei bis maximal 25 MB wählen.');
  const ascii = (a, b) => String.fromCharCode(...bytes.subarray(a, b));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { extension: 'wav', mime: AUDIO_TYPES.wav };
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { extension: 'mp3', mime: AUDIO_TYPES.mp3 };
  if (ascii(0, 4) === 'OggS') return { extension: 'ogg', mime: AUDIO_TYPES.ogg };
  if (ascii(4, 8) === 'ftyp') return { extension: 'm4a', mime: AUDIO_TYPES.m4a };
  throw new Error('Bitte MP3, WAV, M4A oder Ogg hochladen.');
}
