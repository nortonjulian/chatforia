import { get, set, del } from 'idb-keyval';
import { decryptMessageForUserBrowser } from './decryptionClient.js';
import { loadKeysLocal, clearKeysLocal } from './keys.js';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { getOrCreateBrowserDeviceRecord, getBrowserDevicePrivateKeyBytes } from './browserDeviceClient.js';

/* ============================================================
 * Tiny byte and WebCrypto helpers
 * ========================================================== */

let _unlockPromise = null;
let _cachedUnlockedBundle = null;

const te = new TextEncoder();
const td = new TextDecoder();
const utf8Bytes = (str) => new TextEncoder().encode(str);

const b642bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytes2b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));


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
    try {
      return b642bytes(v);
    } catch {
      return hex2bytes(v);
    }
  }
  throw new Error('Unsupported byte-like input');
};

const randBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function getUnlockedBundleCached() {
  if (_cachedUnlockedBundle) return _cachedUnlockedBundle;
  if (_unlockPromise) return _unlockPromise;

  _unlockPromise = getUnlockedBundleOrThrow()
    .then((bundle) => {
      _cachedUnlockedBundle = bundle;
      return bundle;
    })
    .finally(() => {
      _unlockPromise = null;
    });

  return _unlockPromise;
}

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

async function hkdfSha256(sharedSecretBytes, saltBytes, infoBytes, length = 32) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sharedSecretBytes,
    'HKDF',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: infoBytes,
    },
    keyMaterial,
    length * 8
  );

  return new Uint8Array(bits);
}

async function importAesGcmKeyRaw(rawBytes) {
  return crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

/**
 * Decode either standard base64 OR base64url (and tolerate missing padding/newlines).
 * This matches the server’s tolerant decoder.
 */
function decodeB64Any(input, label = 'key') {
  if (!input || typeof input !== 'string') {
    throw new Error(`${label}: missing or not a string`);
  }

  let s = input.trim().replace(/\s+/g, '');

  if (s.includes('-----BEGIN')) {
    throw new Error(
      `${label}: looks like PEM (RSA) but NaCl base64 key is required for E2EE. Regenerate/migrate keys.`
    );
  }

  s = s.replace(/^base64:/i, '');
  s = s.replace(/-/g, '+').replace(/_/g, '/');

  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);

  return naclUtil.decodeBase64(s);
}

/* ============================================================
 * At-rest key storage (encrypted with passcode)
 * ========================================================== */

const DB_KEY = 'chatforia:keys:v2';
const LEGACY_KEY = 'chatforia:keys:v1';

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
    publicKey,
    enc: { saltB64, iterations, ivB64, ctB64 },
  };

  await set(DB_KEY, rec);

  _derivedKey = key;
  _saltB64 = saltB64;
  _iterations = iterations;
  _cachedUnlockedBundle = { publicKey, privateKey };

  return rec;
}

async function getUnlockedBundleOrThrow() {
  console.log('[E2EE] getUnlockedBundleOrThrow ENTER');

  let trustedLocal = null;

  // Skip this path on web for now because IndexedDB open timeout is slower
  // than our encrypted bundle path and causes startup drag.
  if (typeof window === 'undefined') {
    try {
      trustedLocal = await loadKeysLocal();
    } catch {
      trustedLocal = null;
    }
  }

  if (trustedLocal?.privateKey && trustedLocal?.publicKey) {
    console.log('[E2EE] using trusted-device keys');
    return trustedLocal;
  }

  let legacyIdx = null;
  try {
    console.log('[E2EE] before get(LEGACY_KEY)');
    legacyIdx = await get(LEGACY_KEY);
    console.log('[E2EE] after get(LEGACY_KEY)', legacyIdx);
  } catch (e) {
    console.warn('[E2EE] get(LEGACY_KEY) threw', e?.message || e);
  }

  if (legacyIdx?.privateKey && legacyIdx?.publicKey) {
    console.log('[E2EE] using legacy IndexedDB keys');
    return legacyIdx;
  }

  let legacyLS = null;
  try {
    console.log('[E2EE] before readLegacyLocalStorage()');
    legacyLS = readLegacyLocalStorage();
    console.log('[E2EE] after readLegacyLocalStorage()', legacyLS);
  } catch (e) {
    console.warn('[E2EE] readLegacyLocalStorage() threw', e?.message || e);
  }

  if (legacyLS?.privateKey && legacyLS?.publicKey) {
    console.log('[E2EE] using legacy localStorage keys');
    return legacyLS;
  }

  let rec = null;
  try {
    console.log('[E2EE] before get(DB_KEY)');
    rec = await get(DB_KEY);
    console.log('[E2EE] after get(DB_KEY)', rec);
  } catch (e) {
    console.warn('[E2EE] get(DB_KEY) threw', e?.message || e);
  }

  if (rec?.enc) {
    if (!_derivedKey) {
      console.warn('[E2EE] encrypted bundle exists but is LOCKED');
      throw new Error('LOCKED');
    }

    const { ivB64, ctB64 } = rec.enc;
    const pt = await aesGcmDecrypt(_derivedKey, ivB64, ctB64);
    const obj = JSON.parse(td.decode(pt));

    if (!obj?.privateKey || !obj?.publicKey) {
      throw new Error('Corrupt key bundle');
    }

    console.log('[E2EE] decrypted encrypted bundle successfully');
    return obj;
  }

  try {
    console.log('[E2EE] attempting approved-pairing bootstrap');

    const installed = await tryInstallKeysFromApprovedPairing(null);

    if (installed) {
      console.log('[E2EE] approved-pairing bootstrap succeeded');
      return await getUnlockedBundleOrThrow();
    }
  } catch (e) {
    console.warn('[E2EE] approved-pairing bootstrap failed', e?.message || e);
  }

  console.warn('[E2EE] no local keypair found anywhere');
  throw new Error('No local keypair found');
}

/* ============================================================
 * Public: local key bundle metadata & management
 * ========================================================== */

async function hkdfAesKeyFromSharedSecret(sharedSecretBytes) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    sharedSecretBytes,
    'HKDF',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: te.encode('chatforia-device-pairing-v1'),
      info: new Uint8Array([]),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

function parseWrappedPayloadString(wrappedAccountKey) {
  if (!wrappedAccountKey || typeof wrappedAccountKey !== 'string') {
    throw new Error('Missing wrappedAccountKey');
  }

  let parsed;
  try {
    parsed = JSON.parse(wrappedAccountKey);
  } catch {
    throw new Error('wrappedAccountKey is not valid JSON');
  }

  const { version, algorithm, senderPublicKey, nonce, ciphertext } = parsed || {};

  if (!senderPublicKey || !nonce || !ciphertext) {
    throw new Error('wrappedAccountKey missing fields');
  }

  if (algorithm !== 'x25519-aesgcm') {
    throw new Error(`Unsupported pairing algorithm: ${algorithm}`);
  }

  return { version, algorithm, senderPublicKey, nonce, ciphertext };
}

export async function requestBrowserPairing(authToken) {
  const browser = await getOrCreateBrowserDeviceRecord();

  const headers = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch('/devices/pairing/request', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      deviceId: browser.deviceId,
      name: browser.name,
      platform: browser.platform,
      publicKey: browser.publicKey,
      keyAlgorithm: browser.keyAlgorithm,
      keyVersion: browser.keyVersion,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pairing request failed: ${text || res.status}`);
  }

  return res.json();
}

export async function installPairedDeviceBundle({
  wrappedAccountKey,
  passcode,
}) {
  const unwrapped = await unwrapPairedAccountKeys(wrappedAccountKey);

  await saveEncryptedBundle(
    {
      publicKey: unwrapped.publicKey,
      privateKey: unwrapped.privateKey,
    },
    passcode
  );

  return {
    publicKey: unwrapped.publicKey,
    installed: true,
  };
}

export async function unwrapPairedAccountKeys(wrappedAccountKey) {
  const wrapped = parseWrappedPayloadString(wrappedAccountKey);

  const browserPrivateKey = await getBrowserDevicePrivateKeyBytes();
  if (!browserPrivateKey) {
    throw new Error('Missing browser device private key');
  }

  const senderPublicKeyBytes = decodeB64Any(
    wrapped.senderPublicKey,
    'wrapped.senderPublicKey'
  );

  const sharedSecret = nacl.scalarMult(browserPrivateKey, senderPublicKeyBytes);
  const aesKey = await hkdfAesKeyFromSharedSecret(sharedSecret);

  const nonceBytes = decodeB64Any(wrapped.nonce, 'wrapped.nonce');
  const ciphertextBytes = decodeB64Any(wrapped.ciphertext, 'wrapped.ciphertext');

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonceBytes },
    aesKey,
    ciphertextBytes
  );

  const obj = JSON.parse(td.decode(plaintext));

  if (!obj?.publicKey || !obj?.privateKey) {
    throw new Error('Wrapped payload missing account keys');
  }

  return obj;
}

export async function fetchBrowserPairingStatus(authToken) {
  const browser = await getOrCreateBrowserDeviceRecord();

  const headers = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(
    `/devices/pairing/status/${encodeURIComponent(browser.deviceId)}`,
    {
      method: 'GET',
      credentials: 'include',
      headers,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pairing status failed: ${text || res.status}`);
  }

  return res.json();
}

export async function tryInstallKeysFromApprovedPairing(authToken) {
  const { device } = await fetchBrowserPairingStatus(authToken);

  if (!device) return false;
  if (device.revokedAt) return false;
  if (device.pairingStatus !== 'approved') return false;
  if (!device.wrappedAccountKey) return false;

  const localPasscode = crypto.randomUUID();

  await installPairedDeviceBundle({
    wrappedAccountKey: device.wrappedAccountKey,
    passcode: localPasscode,
  });

  persistUnlockPasscodeForSession(localPasscode);
  return true;
}

export async function getUnlockedPrivateKey() {
  console.log('[E2EE encryptionClient] getUnlockedPrivateKey called');
  const { privateKey, publicKey } = await getUnlockedBundleCached();
  console.log('[E2EE encryptionClient] unlocked bundle found', {
    hasPrivateKey: !!privateKey,
    hasPublicKey: !!publicKey,
    privateKeyPreview: privateKey?.slice?.(0, 40) || null,
    publicKeyPreview: publicKey?.slice?.(0, 40) || null,
  });
  return privateKey;
}

export async function getLocalKeyBundleMeta() {
  let trustedLocal = null;

  // Same optimization as startup path: avoid slow IndexedDB trusted-local load on web.
  if (typeof window === 'undefined') {
    try {
      trustedLocal = await loadKeysLocal();
    } catch {
      trustedLocal = null;
    }
  }

  if (trustedLocal?.privateKey && trustedLocal?.publicKey) {
    return {
      version: 'trusted-device',
      createdAt: null,
      hasEncrypted: false,
      publicKey: trustedLocal.publicKey,
    };
  }

  const legacy = (await get(LEGACY_KEY)) || readLegacyLocalStorage();
  if (legacy?.privateKey && legacy?.publicKey) {
    return {
      version: 'v1-legacy',
      createdAt: legacy.createdAt || null,
      hasEncrypted: false,
      publicKey: legacy.publicKey,
    };
  }

  const rec = await get(DB_KEY);
  if (rec) {
    return {
      version: rec.version,
      createdAt: rec.createdAt,
      hasEncrypted: !!rec.enc,
      publicKey: rec.publicKey ?? null,
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
  _cachedUnlockedBundle = obj;

  return obj;
}

export async function getUnlockedPrivateKeyForPublicKey(expectedPublicKey) {
  console.log('[E2EE encryptionClient] getUnlockedPrivateKeyForPublicKey called', {
    expectedPublicKeyPreview: expectedPublicKey?.slice?.(0, 40) || null,
  });

  const { privateKey, publicKey } = await getUnlockedBundleCached();

  console.log('[E2EE encryptionClient] comparing local vs expected publicKey', {
    localPublicKeyPreview: publicKey?.slice?.(0, 40) || null,
    expectedPublicKeyPreview: expectedPublicKey?.slice?.(0, 40) || null,
  });

  if (!expectedPublicKey) {
    throw new Error('Missing expected public key');
  }

  if (!publicKey || publicKey !== expectedPublicKey) {
    throw new Error('LOCAL_KEY_MISMATCH');
  }

  const privateKeyBytes = naclUtil.decodeBase64(privateKey);
  const derivedPublicKey = naclUtil.encodeBase64(
    nacl.box.keyPair.fromSecretKey(privateKeyBytes).publicKey
  );

  console.log('[E2EE encryptionClient] keypair integrity check', {
    storedPublicKeyPreview: publicKey?.slice?.(0, 40) || null,
    derivedPublicKeyPreview: derivedPublicKey?.slice?.(0, 40) || null,
    expectedPublicKeyPreview: expectedPublicKey?.slice?.(0, 40) || null,
    matchesStored: derivedPublicKey === publicKey,
    matchesExpected: derivedPublicKey === expectedPublicKey,
  });

  return privateKey;
}

export function lockKeyBundle() {
  _derivedKey = null;
  _saltB64 = null;
  _cachedUnlockedBundle = null;
}

export function clearUnlockedBundleCache() {
  _unlockPromise = null;
  _cachedUnlockedBundle = null;
}

/* ============================================================
 * Session unlock persistence (NEW)
 * ========================================================== */

export function persistUnlockPasscodeForSession(passcode) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem('chatforia:keyPasscode', passcode);
}

export function getPersistedUnlockPasscodeForSession() {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('chatforia:keyPasscode');
}

export function clearPersistedUnlockPasscodeForSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('chatforia:keyPasscode');
}

export async function clearLocalKeyBundle() {
  await del(DB_KEY);
  try {
    await del(LEGACY_KEY);
  } catch {}
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
  try {
    await clearKeysLocal();
  } catch {}

  lockKeyBundle();
  clearUnlockedBundleCache();
}

export async function decryptSym({ key, iv, ciphertext }) {
  const k = await importAesKey(key);
  const ivBytes = guessToBytes(iv);
  const ctBytes = guessToBytes(ciphertext);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, k, ctBytes);
  return td.decode(pt);
}

export async function encryptSym(plaintext) {
  const rawKey = randBytes(32);
  const aesKey = await importAesKeyRaw(rawKey);
  const iv = randBytes(12);

  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    te.encode(String(plaintext ?? ''))
  );

  return {
    keyRaw: rawKey,
    ivBytes: iv,
    ctBytes: new Uint8Array(ctBuf),
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
      let encryptedKey = null;

      try {
        encryptedKey =
          msg.encryptedKeyForMe ??
          (msg.encryptedKeys &&
            (msg.encryptedKeys[String(currentUserId)] ||
              msg.encryptedKeys[currentUserId] ||
              msg.encryptedKeys['me'])) ??
          null;

        const senderPublicKey =
          senderPublicKeys?.[String(msg.sender?.id)] ||
          senderPublicKeys?.[msg.sender?.id] ||
          msg.sender?.publicKey ||
          null;

        console.log('[decryptFetchedMessages] attempting', {
          msgId: msg.id,
          hasCiphertext: !!msg.contentCiphertext,
          hasEncryptedKeyForMe: !!msg.encryptedKeyForMe,
          encryptedKeyPreview:
            typeof encryptedKey === 'string' ? encryptedKey.slice(0, 120) : encryptedKey,
          senderId: msg.sender?.id,
          senderPublicKeyPreview: senderPublicKey?.slice?.(0, 60) || null,
          currentUserId,
          selectedEncryptedKeyOwner:
            msg.encryptedKeys && currentUserId != null
              ? Object.prototype.hasOwnProperty.call(msg.encryptedKeys, String(currentUserId))
              : null,
          encryptedKeyUserIds: msg.encryptedKeys ? Object.keys(msg.encryptedKeys) : null,
        });

        if (!encryptedKey) {
          return { ...msg, decryptedContent: '[Encrypted – key unavailable]' };
        }

        const decrypted = await decryptMessageForUserBrowser(
          msg.contentCiphertext,
          encryptedKey,
          currentUserPrivateKey,
          senderPublicKey,
          currentUserId
        );

        return { ...msg, decryptedContent: decrypted };
      } catch (err) {
        console.warn(`[decryptFetchedMessages] failed for message ${msg.id}`, {
          error: err?.message || err,
          encryptedKeyPreview:
            typeof encryptedKey === 'string' ? encryptedKey.slice(0, 120) : encryptedKey,
          encryptedKeyForMe: msg.encryptedKeyForMe,
          encryptedKeyUserIds: msg.encryptedKeys ? Object.keys(msg.encryptedKeys) : null,
          currentUserId,
          senderId: msg.sender?.id,
          senderPublicKey:
            senderPublicKeys?.[String(msg.sender?.id)] ||
            senderPublicKeys?.[msg.sender?.id] ||
            msg.sender?.publicKey ||
            null,
        });

        return { ...msg, decryptedContent: '[Encrypted – could not decrypt]' };
      }
    })
  );
}

export async function reportMessage(payload) {
  return fetch('/messages/report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(payload),
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
 * Strict E2EE encryptor for MessageInput
 * Produces:
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

async function sealSessionKeyForRecipient(sessionKeyRawU8, senderPrivB64, recipientPubB64, meta = {}) {
  let recipientPub;
  try {
    recipientPub = decodeB64Any(
      recipientPubB64,
      `recipientPublicKey userId=${meta.recipientId ?? 'unknown'}`
    );
  } catch (e) {
    throw new Error(
      `[E2EE] Base64 decode failed (${e.message}). recipientId=${meta.recipientId ?? 'unknown'}`
    );
  }

  // Generate ephemeral Curve25519 keypair for this recipient
  const ephemeral = nacl.box.keyPair();

  // Derive shared secret compatible with iOS/CryptoKit path
  const sharedSecret = nacl.scalarMult(ephemeral.secretKey, recipientPub);

  const wrappingKeyRaw = await hkdfSha256(
    sharedSecret,
    utf8Bytes('chatforia-msg-wrap-v1'),
    utf8Bytes(`user:${meta.recipientId ?? 'unknown'}`),
    32
  );

  const wrappingKey = await importAesGcmKeyRaw(wrappingKeyRaw);

  // AES-GCM encrypt the 32-byte session key
  const iv = randBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    sessionKeyRawU8
  );

  // Match CryptoKit "combined" layout: nonce(12) + ciphertext+tag
  const wrappedCombined = concatBytes(iv, new Uint8Array(wrapped));

  return JSON.stringify({
    alg: 'x25519-aesgcm',
    epk: naclUtil.encodeBase64(ephemeral.publicKey),
    wrappedKey: bytes2b64(wrappedCombined),
  });
}

export async function encryptForRoom(participants = [], plaintext = '', currentUserId) {
  const { publicKey: senderPubB64, privateKey: senderPrivB64 } =
    await getUnlockedBundleCached();

  const { keyRaw, ivBytes, ctBytes } = await encryptSym(plaintext);

  const tagLen = 16;
  if (ctBytes.length < tagLen) throw new Error('Ciphertext too short');

  const encPart = ctBytes.slice(0, ctBytes.length - tagLen);
  const tagPart = ctBytes.slice(ctBytes.length - tagLen);

  const packedCiphertext = concatBytes(ivBytes, encPart, tagPart);
  const ciphertext = bytes2b64(packedCiphertext);

  const encryptedKeys = {};

  const uniq = new Map();
  for (const p of participants || []) {
    const userId = p?.id ?? p?.userId ?? p?.user?.id;
    const publicKey = p?.publicKey ?? p?.user?.publicKey;
    if (!userId || !publicKey) continue;
    if (!uniq.has(userId)) uniq.set(userId, publicKey);
  }

  for (const [userId, recipientPub] of uniq.entries()) {
    encryptedKeys[String(userId)] = await sealSessionKeyForRecipient(
      keyRaw,
      senderPrivB64,
      recipientPub,
      { senderId: currentUserId, recipientId: userId }
    );
  }

  encryptedKeys[String(currentUserId)] = await sealSessionKeyForRecipient(
    keyRaw,
    senderPrivB64,
    senderPubB64,
    { senderId: currentUserId, recipientId: currentUserId }
  );

  return {
    ciphertext,
    encryptedKeys,
    encryptionVersion: 'v2',
  };
}