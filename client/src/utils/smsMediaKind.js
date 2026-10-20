export function smsMediaKind(item, responseType = '') {
  const raw = typeof item === 'string' ? item : item?.url || '';
  const declared = typeof item === 'object' ? item?.contentType || item?.mimeType || '' : '';
  const actual = String(responseType).split(';')[0].trim().toLowerCase();
  const mime = actual && actual !== 'application/octet-stream' ? actual : String(declared).toLowerCase();
  for (const kind of ['audio', 'video', 'image']) if (mime.startsWith(kind + '/')) return kind;
  // Explicit incompatible content types must never render as an image/player.
  if (mime && mime !== 'application/octet-stream') return 'file';
  let pathname = '';
  try { pathname = new URL(raw, 'https://invalid.example').pathname.toLowerCase(); } catch { return 'file'; }
  if (/\.(m4a|mp3|wav|aac|ogg|amr)$/.test(pathname)) return 'audio';
  if (/\.(mp4|mov|webm|3gp)$/.test(pathname)) return 'video';
  if (/\.(jpe?g|png|gif|webp|heic|heif)$/.test(pathname)) return 'image';
  return 'file';
}
