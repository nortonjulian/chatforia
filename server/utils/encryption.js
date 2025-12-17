import crypto from 'crypto';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

// Helper: Buffer → Uint8Array
const toU8 = (buf) => new Uint8Array(buf);

/**
 * Decode either standard base64 OR base64url (and tolerate missing padding/newlines).
 * tweetnacl-util expects standard base64; this normalizes first.
 */
function decodeB64Any(input, label = 'key') {
  if (!input || typeof input !== 'string') {
    throw new Error(`[E2EE] ${label}: missing or not a string`);
  }

  // trim + remove whitespace/newlines
  let s = input.trim().replace(/\s+/g, '');

  // strip common prefixes if they ever show up
  s = s.replace(/^base64:/i, '');

  // base64url -> base64
  s = s.replace(/-/g, '+').replace(/_/g, '/');

  // pad to multiple of 4
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);

  return naclUtil.decodeBase64(s);
}

/**
 * Generate a NaCl box keypair.
 * NOTE: In true E2EE, the privateKey should only ever be stored client-side.
 */
export function generateKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    privateKey: naclUtil.encodeBase64(keyPair.secretKey),
  };
}

/**
 * (Optional) Decrypts a message for a user.
 * In true E2EE, decryption should happen on the client.
 *
 * @param {string} ciphertext - base64 of [iv(12) | tag(16) | enc]
 * @param {string} encryptedSessionKey - base64 of [nonce(24) | box]
 * @param {string} currentUserPrivateKey - base64
 * @param {string} senderPublicKey - base64 of the key that sealed the session key
 * @returns {string} plaintext
 */
export function decryptMessageForUser(
  ciphertext,
  encryptedSessionKey,
  currentUserPrivateKey,
  senderPublicKey
) {
  const keyBuf = decodeB64Any(encryptedSessionKey, 'encryptedSessionKey');
  const nonce = keyBuf.slice(0, 24);
  const boxData = keyBuf.slice(24);

  const sessionKeyU8 = nacl.box.open(
    boxData,
    nonce,
    decodeB64Any(senderPublicKey, 'senderPublicKey'),
    decodeB64Any(currentUserPrivateKey, 'currentUserPrivateKey')
  );
  if (!sessionKeyU8) throw new Error('Unable to decrypt session key');

  const sessionKey = Buffer.from(sessionKeyU8);

  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/* -------------------------------------------------------------------------
  Option A note:
  - encryptMessageForParticipants() has been intentionally removed.
  - Message encryption + per-recipient key sealing must happen on the client.
--------------------------------------------------------------------------- */
