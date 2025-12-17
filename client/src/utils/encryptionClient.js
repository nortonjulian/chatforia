import { get, set, del } from 'idb-keyval';
import { decryptMessageForUserBrowser } from './decryptionClient.js';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/* ============================================================
 * Tiny byte and WebCrypto helpers
 * ========================================================== */

const te = new TextEncoder();
const td = new TextDecoder();

const b642bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytes2b64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));

const hex2bytes = (hex) => {
  const s = hex.replace(/^0x/, '').toLowerCase();
  if (s.length % 2) throw new Error('Invalid hex length');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const guessToBytes = (v) => {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === 'string') {
    // Heuristics: try base64 first; fallback to hex
    try {
      return b642bytes(v);
    } catch {
      return hex2bytes(v);
    }
  }
  throw new Error('Unsupported byte-like input');
};

const randBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function importAesKeyRaw(raw) {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function importAesKey(key) {
  if (key instanceof CryptoKey) return key;
  const raw = guessToBytes(key);
  return importAesKeyRaw(raw);
}

/**
 * Decode either standard base64 OR base64url (and tolerate missing padding/newlines).
 * This matches the server’s tolerant decoder.
 */
function decodeB64Any(input, label = 'key') {
  if (!input || typeof input !== 'string') {
    throw new Error(`${label}: missing or not a string`);
  }

  // trim + remove whitespace/newlines
  let s = input.trim().replace(/\s+/g, '');

  // PEM detected? This is NOT a NaCl key.
  if (s.includes('-----BEGIN')) {
    throw new Error(
      `${label}: looks like PEM (RSA) but NaCl base64 key is required for E2EE. Regenerate/migrate keys.`
    );
  }

  // strip common prefixes if they ever show up
  s = s.replace(/^base64:/i, '');

  // base64url -> base64
  s = s.replace(/-/g, '+').replace(/_/g, '/');

  // pad to multiple of 4
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);

  return naclUtil.decodeBase64(s);
}

/* ============================================================
 * At-rest key storage (encrypted with passcode)
 * ========================================================== */

const DB_KEY = 'chatforia:keys:v2'; // encrypted-at-rest record
const LEGACY_KEY = 'chatforia:keys:v1'; // old (plaintext) record if it exists

// In-memory cache of the derived key (cleared on lock)
let _derivedKey = null;
let _saltB64 = null;
let _iterations = 250_000;

function readLegacyLocalStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function deriveAesKey(passcode, saltB64, iterations = 250_000) {
  const salt = b642bytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    te.encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesGcmEncrypt(key, plaintextBytes) {
  const iv = randBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes);
  return { ivB64: bytes2b64(iv), ctB64: bytes2b64(ct) };
}

async function aesGcmDecrypt(key, ivB64, ctB64) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b642bytes(ivB64) },
    key,
    b642bytes(ctB64)
  );
  return new Uint8Array(pt);
}

/** Save bundle encrypted with a passcode (used by install & migration). */
async function saveEncryptedBundle({ publicKey, privateKey }, passcode) {
  if (!publicKey || !privateKey) throw new Error('Missing keys');
  const saltB64 = bytes2b64(randBytes(16));
  const iterations = _iterations;
  const key = await deriveAesKey(passcode, saltB64, iterations);

  const payload = JSON.stringify({ publicKey, privateKey });
  const { ivB64, ctB64 } = await aesGcmEncrypt(key, te.encode(payload));

  const rec = {
    version: 'v2',
    createdAt: new Date().toISOString(),
    publicKey, // non-sensitive; useful without unlock
    enc: { saltB64, iterations, ivB64, ctB64 },
  };
  await set(DB_KEY, rec);

  _derivedKey = key;
  _saltB64 = saltB64;
  _iterations = iterations;

  return rec;
}

/** Internal: returns { publicKey, privateKey } if unlocked; else throws 'LOCKED'. */
async function getUnlockedBundleOrThrow() {
  // v2 path
  const rec = await get(DB_KEY);
  if (rec?.enc) {
    if (!_derivedKey) {
      throw new Error('LOCKED'); // user must unlock with passcode first
    }
    const { ivB64, ctB64 } = rec.enc;
    const pt = await aesGcmDecrypt(_derivedKey, ivB64, ctB64);
    const obj = JSON.parse(td.decode(pt));
    if (!obj?.privateKey || !obj?.publicKey) throw new Error('Corrupt key bundle');
    return obj;
  }
  // legacy fallbacks
  const legacyIdx = await get(LEGACY_KEY);
  if (legacyIdx?.privateKey && legacyIdx?.publicKey) return legacyIdx;

  const legacyLS = readLegacyLocalStorage();
  if (legacyLS?.privateKey && legacyLS?.publicKey) return legacyLS;

  throw new Error('No local keypair found');
}

/* ============================================================
 * Public: local key bundle metadata & management
 * ========================================================== */

export async function getLocalKeyBundleMeta() {
  const rec = await get(DB_KEY);
  if (rec)
    return {
      version: rec.version,
      createdAt: rec.createdAt,
      hasEncrypted: !!rec.enc,
      publicKey: rec.publicKey ?? null,
    };
  // also check legacy
  const legacy = (await get(LEGACY_KEY)) || readLegacyLocalStorage();
  if (legacy?.privateKey && legacy?.publicKey) {
    return {
      version: 'v1-legacy',
      createdAt: legacy.createdAt || null,
      hasEncrypted: false,
      publicKey: legacy.publicKey,
    };
  }
  return null;
}

export async function hasEncryptedBundle() {
  const rec = await get(DB_KEY);
  return !!rec?.enc;
}

export async function getPublicKeyNoUnlock() {
  const rec = await get(DB_KEY);
  if (rec?.publicKey) return rec.publicKey;
  const legacy = (await get(LEGACY_KEY)) || readLegacyLocalStorage();
  return legacy?.publicKey || null;
}

export async function enableKeyPasscode(passcode) {
  if (!passcode || passcode.length < 6) throw new Error('Passcode too short');

  // Try legacy from IndexedDB first
  let legacy = await get(LEGACY_KEY);
  if (!legacy) {
    const ls = readLegacyLocalStorage();
    if (ls) legacy = ls;
  }
  if (!legacy?.privateKey || !legacy?.publicKey) {
    throw new Error('No local keypair found to protect');
  }

  await saveEncryptedBundle(
    { publicKey: legacy.publicKey, privateKey: legacy.privateKey },
    passcode
  );

  // Clean legacy copies
  try {
    await del(LEGACY_KEY);
  } catch {}
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}

  return true;
}

export async function unlockKeyBundle(passcode) {
  const rec = await get(DB_KEY);
  if (!rec?.enc) throw new Error('No encrypted bundle to unlock');

  const { saltB64, iterations, ivB64, ctB64 } = rec.enc;
  const key = await deriveAesKey(passcode, saltB64, iterations);
  const pt = await aesGcmDecrypt(key, ivB64, ctB64);
  const obj = JSON.parse(td.decode(pt));

  if (!obj?.privateKey || !obj?.publicKey) throw new Error('Corrupt key bundle');

  _derivedKey = key;
  _saltB64 = saltB64;
  _iterations = iterations;

  return obj; // { publicKey, privateKey }
}

export function lockKeyBundle() {
  _derivedKey = null;
  _saltB64 = null;
}

export async function clearLocalKeyBundle() {
  await del(DB_KEY);
  try {
    await del(LEGACY_KEY);
  } catch {}
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
  lockKeyBundle();
}

/* ============================================================
 * Symmetric helpers (encrypt/decrypt)
 * ========================================================== */

/**
 * Decrypt AES-GCM payload and return plaintext (UTF-8 string).
 * Accepts key as CryptoKey, Uint8Array, ArrayBuffer, or base64/hex string.
 * `iv` and `ciphertext` can be Uint8Array or base64/hex strings.
 */
export async function decryptSym({ key, iv, ciphertext }) {
  const k = await importAesKey(key);
  const ivBytes = guessToBytes(iv);
  const ctBytes = guessToBytes(ciphertext);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, k, ctBytes);
  return td.decode(pt);
}

/**
 * Encrypt plaintext with a fresh 256-bit AES-GCM key.
 * Returns base64 iv/ct, algorithm tag, and the raw AES key bytes for wrapping.
 *
 * NOTE: WebCrypto returns ct as [enc | tag] (tag appended).
 * Our server expects ciphertext layout base64([iv | tag | enc]).
 */
export async function encryptSym(plaintext) {
  const rawKey = randBytes(32); // 256-bit AES key
  const aesKey = await importAesKeyRaw(rawKey);
  const iv = randBytes(12);

  // WebCrypto output = enc||tag (tag is last 16 bytes)
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    te.encode(String(plaintext ?? ''))
  );

  return {
    keyRaw: rawKey,              // Uint8Array (32 bytes)
    ivBytes: iv,                 // Uint8Array (12 bytes)
    ctBytes: new Uint8Array(ctBuf), // Uint8Array (enc||tag)
    alg: 'A256GCM',
  };
}

/* ============================================================
 * Message decryption pipeline (existing usage)
 * ========================================================== */

export async function decryptFetchedMessages(
  messages,
  currentUserPrivateKey,
  senderPublicKeys,
  currentUserId
) {
  return Promise.all(
    messages.map(async (msg) => {
      try {
        const encryptedKey =
          msg.encryptedKeyForMe ??
          (msg.encryptedKeys && msg.encryptedKeys[currentUserId]) ??
          null;

        const senderPublicKey =
          senderPublicKeys?.[msg.sender?.id] || msg.sender?.publicKey || null;

        if (!encryptedKey || !senderPublicKey) {
          return { ...msg, decryptedContent: '[Encrypted – key unavailable]' };
        }

        const decrypted = await decryptMessageForUserBrowser(
          msg.contentCiphertext,
          encryptedKey,
          currentUserPrivateKey,
          senderPublicKey
        );

        return { ...msg, decryptedContent: decrypted };
      } catch (err) {
        console.warn(`Decryption failed for message ${msg.id}:`, err);
        return { ...msg, decryptedContent: '[Encrypted – could not decrypt]' };
      }
    })
  );
}

/* ============================================================
 * Reporting helper
 * ========================================================== */

export async function reportMessage(messageId, decryptedContent, reporterId) {
  return fetch('/messages/report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ messageId, reporterId, decryptedContent }),
  });
}

/* ============================================================
 * Provisioning helpers (primary ↔ new device)
 * ========================================================== */

export async function exportLocalPrivateKeyBundle(passcode) {
  const { publicKey, privateKey } = await unlockKeyBundle(passcode);
  return {
    version: 'v1',
    createdAt: new Date().toISOString(),
    publicKey,
    privateKey,
    meta: { source: 'primary-device' },
  };
}

export async function installLocalPrivateKeyBundle(received, passcode) {
  if (!received?.privateKey || !received?.publicKey) {
    throw new Error('Received bundle is missing keys');
  }
  if (!passcode) throw new Error('Passcode required to protect keys');

  await saveEncryptedBundle(
    { publicKey: received.publicKey, privateKey: received.privateKey },
    passcode
  );
  return true;
}

/* ============================================================
 * NEW: Strict E2EE encryptor for MessageInput
 * Produces EXACT server format:
 *   - ciphertext: base64([iv(12) | tag(16) | enc])
 *   - encryptedKeys: { [userId]: base64([nonce(24) | box]) }
 * ========================================================== */

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + (p?.length || 0), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    if (!p?.length) continue;
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Seal a 32-byte session key for one recipient using NaCl box.
 * Output (base64) packs: [nonce(24) | box]
 */
function sealSessionKeyForRecipient(sessionKeyRawU8, senderPrivB64, recipientPubB64, meta = {}) {
  const nonce = randBytes(24);

  let recipientPub;
  let senderPriv;
  try {
    recipientPub = decodeB64Any(recipientPubB64, `recipientPublicKey userId=${meta.recipientId ?? 'unknown'}`);
    senderPriv = decodeB64Any(senderPrivB64, `senderPrivateKey userId=${meta.senderId ?? 'unknown'}`);
  } catch (e) {
    throw new Error(`[E2EE] Base64 decode failed (${e.message}). senderId=${meta.senderId ?? 'unknown'} recipientId=${meta.recipientId ?? 'unknown'}`);
  }

  const boxed = nacl.box(sessionKeyRawU8, nonce, recipientPub, senderPriv);
  const packed = concatBytes(nonce, boxed);
  return naclUtil.encodeBase64(packed);
}

/**
 * High-level encryptor used by the message composer (STRICT E2EE).
 * Returns: { ciphertext, encryptedKeys }
 */
export async function encryptForRoom(participants = [], plaintext = '') {
  // 0) Need sender keypair locally (unlocked if passcode enabled)
  const { publicKey: senderPubB64, privateKey: senderPrivB64 } = await getUnlockedBundleOrThrow();

  // 1) Encrypt the plaintext once with AES-GCM (WebCrypto)
  const { keyRaw, ivBytes, ctBytes } = await encryptSym(plaintext);

  // WebCrypto ctBytes = enc||tag (tag appended)
  const tagLen = 16; // AES-GCM 128-bit tag
  if (ctBytes.length < tagLen) throw new Error('Ciphertext too short');

  const encPart = ctBytes.slice(0, ctBytes.length - tagLen);
  const tagPart = ctBytes.slice(ctBytes.length - tagLen);

  // Server expects base64([iv | tag | enc])
  const packedCiphertext = concatBytes(ivBytes, tagPart, encPart);
  const ciphertext = bytes2b64(packedCiphertext);

  // 2) Build encryptedKeys map for all participants (and always include self)
  const encryptedKeys = {};

  const uniq = new Map();
  for (const p of participants || []) {
    if (!p?.id || !p?.publicKey) continue;
    if (!uniq.has(p.id)) uniq.set(p.id, p.publicKey);
  }
  // always include self if not present
  if (!uniq.has('self')) {
    // nothing, we’ll seal to self below using senderPubB64
  }

  // Seal to each participant
  for (const [userId, recipientPub] of uniq.entries()) {
    encryptedKeys[String(userId)] = sealSessionKeyForRecipient(
      keyRaw,
      senderPrivB64,
      recipientPub,
      { senderId: 'me', recipientId: userId }
    );
  }

  // Always seal to the sender as well (multi-device / re-download)
  encryptedKeys['me'] = sealSessionKeyForRecipient(
    keyRaw,
    senderPrivB64,
    senderPubB64,
    { senderId: 'me', recipientId: 'me' }
  );

  return { ciphertext, encryptedKeys };
}
