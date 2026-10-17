// Dependency-free regression checks: node --test client/scripts/test-encrypted-original.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { encryptedOriginalCiphertext, preserveEncryptedOriginal, visibleOriginal } from '../src/utils/encryptedOriginal.js';
globalThis.crypto ??= webcrypto;
const bytes = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function open(combined, keyRaw) {
  const packed = bytes(combined);
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12)));
}
const envelope = JSON.stringify({ alg: 'x25519-aesgcm', epk: 'public-key', wrappedKey: 'wrapped-key' });

test('original is encrypted, preserves Unicode/newlines, and leaves legacy key fields intact', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const original = '  Hola, ¿cómo estás?\n日本語 👋  ';
  const result = await preserveEncryptedOriginal(envelope, key, original);
  const parsed = JSON.parse(result);
  assert.equal(parsed.alg, 'x25519-aesgcm');
  assert.equal(parsed.epk, 'public-key');
  assert.equal(parsed.wrappedKey, 'wrapped-key');
  assert.equal(result.includes(original), false);
  assert.equal(await open(encryptedOriginalCiphertext(result), key), original);
});
test('each encryption uses a fresh nonce', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const a = await preserveEncryptedOriginal(envelope, key, 'Hola');
  const b = await preserveEncryptedOriginal(envelope, key, 'Hola');
  assert.notEqual(encryptedOriginalCiphertext(a), encryptedOriginalCiphertext(b));
});
test('tampering and a wrong key cannot reveal the original', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const result = await preserveEncryptedOriginal(envelope, key, 'Hola');
  const ciphertext = encryptedOriginalCiphertext(result);
  await assert.rejects(open(ciphertext, crypto.getRandomValues(new Uint8Array(32))));
  const damaged = bytes(ciphertext); damaged[damaged.length - 1] ^= 1;
  await assert.rejects(open(btoa(String.fromCharCode(...damaged)), key));
});
test('legacy, malformed, and unknown envelopes have no invented original', () => {
  for (const value of [envelope, 'legacy-base64', '{', null, '{}', '{"alg":"other","originalContentCiphertext":"x"}']) {
    assert.equal(encryptedOriginalCiphertext(value), null);
  }
});
const settings = { enabled: true, mine: false, deleted: false };
const msg = {
  encryptedPayloadForMe: { encryptedKey: envelope },
  decryptedOriginalKey: envelope,
  decryptedOriginalContent: 'Hola',
};
test('ON shows original; OFF hides it and toggling does not mutate messages', () => {
  assert.equal(visibleOriginal(msg, 'Hello', settings), 'Hola');
  assert.equal(visibleOriginal(msg, 'Hello', { ...settings, enabled: false }), null);
  assert.equal(visibleOriginal(msg, 'Hello', settings), 'Hola');
});
test('outgoing, deleted, and identical text never duplicate an original', () => {
  assert.equal(visibleOriginal(msg, 'Hello', { ...settings, mine: true }), null);
  assert.equal(visibleOriginal(msg, 'Hello', { ...settings, deleted: true }), null);
  assert.equal(visibleOriginal(msg, 'Hola', settings), null);
});
test('edits reject cached originals from an earlier envelope', () => {
  const edited = { ...msg, encryptedPayloadForMe: { encryptedKey: 'new-envelope' } };
  assert.equal(visibleOriginal(edited, 'New translation', settings), null);
});
test('plaintext legacy messages use real rawContent only with a translation', () => {
  assert.equal(visibleOriginal({ rawContent: 'Hola', translatedForMe: 'Hello' }, 'Hello', settings), 'Hola');
  assert.equal(visibleOriginal({ rawContent: 'Hola' }, 'Hello', settings), null);
  assert.equal(visibleOriginal({ contentCiphertext: 'encrypted', rawContent: 'placeholder', translatedForMe: 'Hello' }, 'Hello', settings), null);
});
