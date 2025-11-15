// Minimal base64 helpers used by the encryptKey worker (ESM)

export function encode(u8) {
  if (!u8 || u8.length === 0) return '';
  return Buffer.from(u8).toString('base64');
}

export function decode(b64) {
  if (!b64) return new Uint8Array();
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf);
}

// Optional helpers if you ever need them:
export function strToU8(str) {
  return new TextEncoder().encode(str);
}
export function u8ToStr(u8) {
  return new TextDecoder().decode(u8);
}

export default { encode, decode, strToU8, u8ToStr };
