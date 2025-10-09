import crypto from 'node:crypto';

const keyB64 = process.env.APP_ENC_KEY || '';
const key = Buffer.from(keyB64, 'base64');

// In dev, fail loudly if the key is wrong-sized so you catch misconfig early.
if (key.length !== 32) {
  console.warn('[secretBox] APP_ENC_KEY must be 32 bytes base64; current length:', key.length);
}

// AES-256-GCM: pack as [iv(12) | tag(16) | ciphertext] base64
export function seal(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function open(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
