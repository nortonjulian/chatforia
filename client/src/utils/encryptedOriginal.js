// Optional extension of the existing x25519-aesgcm key envelope.
// Old readers keep using alg/epk/wrappedKey and the normal contentCiphertext.
// Never put original plaintext in the envelope or infer it from a translation.
export function encryptedOriginalCiphertext(encryptedKey) {
  try {
    const envelope = JSON.parse(encryptedKey);
    return envelope?.alg === 'x25519-aesgcm' &&
      typeof envelope.originalContentCiphertext === 'string' &&
      envelope.originalContentCiphertext.length > 0
      ? envelope.originalContentCiphertext
      : null;
  } catch {
    return null;
  }
}

export async function preserveEncryptedOriginal(encryptedKey, keyRaw, originalText) {
  const envelope = JSON.parse(encryptedKey);
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(originalText)
  ));
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  envelope.originalContentCiphertext = btoa(String.fromCharCode(...combined));
  return JSON.stringify(envelope);
}

// Bind cached plaintext to the exact envelope, so an edit cannot reuse an old original.
export function visibleOriginal(msg, displayText, { enabled, mine, deleted }) {
  if (!enabled || mine || deleted) return null;
  const payloadKey = msg.encryptedPayloadForMe?.encryptedKey ?? msg.encryptedKeyForMe;
  const isEncrypted = Boolean(payloadKey || msg.contentCiphertext || msg.encryptedPayloadForMe);
  const original = isEncrypted
    ? (payloadKey && msg.decryptedOriginalKey === payloadKey ? msg.decryptedOriginalContent : null)
    : (msg.translatedForMe ? msg.rawContent : null);
  if (typeof original !== 'string' || !original.trim() || original.trim() === String(displayText || '').trim()) {
    return null;
  }
  return original;
}
