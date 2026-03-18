import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

function concatUint8Arrays(a, b) {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

function utf8Bytes(str) {
  return new TextEncoder().encode(str);
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

export async function decryptMessageForUserBrowser(
  ciphertext,
  encryptedSessionKey,
  userPrivateKey,
  senderPublicKey, // legacy only
  currentUserId
) {
  const userPrivateKeyUint8 = naclUtil.decodeBase64(userPrivateKey);

  let wrappedKeyB64 = encryptedSessionKey;
  let publicKeyForBox = senderPublicKey;
  let parsedAlg = null;
  let parsedEpk = null;

  if (
    typeof encryptedSessionKey === 'string' &&
    encryptedSessionKey.trim().startsWith('{')
  ) {
    const parsed = JSON.parse(encryptedSessionKey);

    if (!parsed?.wrappedKey) {
      throw new Error('Encrypted key envelope missing wrappedKey');
    }

    wrappedKeyB64 = parsed.wrappedKey;
    parsedAlg = parsed.alg || null;
    parsedEpk = parsed.epk || null;

    if (parsed?.epk) {
      publicKeyForBox = parsed.epk;
    }
  }

  console.log('[decryptMessageForUserBrowser] unwrap inputs', {
    isEnvelope:
      typeof encryptedSessionKey === 'string' &&
      encryptedSessionKey.trim().startsWith('{'),
    alg: parsedAlg,
    hasWrappedKey: !!wrappedKeyB64,
    hasPublicKeyForBox: !!publicKeyForBox,
    publicKeyForBoxPreview: publicKeyForBox?.slice?.(0, 60) || null,
    currentUserId,
  });

  let sessionKey;

  // iOS envelope path
  if (parsedAlg === 'x25519-aesgcm' && parsedEpk) {
    if (!currentUserId) {
      throw new Error('Missing currentUserId for x25519-aesgcm unwrap');
    }

    const epkBytes = naclUtil.decodeBase64(parsedEpk);
    const wrappedKeyBytes = naclUtil.decodeBase64(wrappedKeyB64);

    // CryptoKit used Curve25519.KeyAgreement + HKDF.
    // Use scalarMult with our Curve25519 private key and sender ephemeral public key.
    const sharedSecret = nacl.scalarMult(userPrivateKeyUint8, epkBytes);

    const wrappingKeyRaw = await hkdfSha256(
      sharedSecret,
      utf8Bytes('chatforia-msg-wrap-v1'),
      utf8Bytes(`user:${currentUserId}`),
      32
    );

    const wrappingKey = await crypto.subtle.importKey(
      'raw',
      wrappingKeyRaw,
      'AES-GCM',
      false,
      ['decrypt']
    );

    // wrappedKey is CryptoKit combined = nonce(12) + ciphertext + tag(16)
    if (wrappedKeyBytes.length < 12 + 16) {
      throw new Error('Wrapped key too short');
    }

    const nonce = wrappedKeyBytes.slice(0, 12);
    const ctPlusTag = wrappedKeyBytes.slice(12);

    try {
      const opened = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        wrappingKey,
        ctPlusTag
      );
      sessionKey = new Uint8Array(opened);
    } catch (e) {
      console.error('[decryptMessageForUserBrowser] x25519-aesgcm unwrap failed', {
        error: e?.message || e,
        parsedEpk,
        currentUserId,
      });
      throw new Error('Failed to decrypt session key');
    }
  } else {
    // legacy NaCl box path
    if (!publicKeyForBox) {
      throw new Error('Missing sender/ephemeral public key for unwrap');
    }

    const encryptedSessionKeyUint8 = naclUtil.decodeBase64(wrappedKeyB64);
    const publicKeyUint8 = naclUtil.decodeBase64(publicKeyForBox);

    const nonce = encryptedSessionKeyUint8.slice(0, 24);
    const box = encryptedSessionKeyUint8.slice(24);

    sessionKey = nacl.box.open(
      box,
      nonce,
      publicKeyUint8,
      userPrivateKeyUint8
    );

    if (!sessionKey) {
      console.error('[decryptMessageForUserBrowser] nacl.box.open failed', {
        wrappedKeyB64,
        publicKeyForBox,
      });
      throw new Error('Failed to decrypt session key');
    }
  }

  const decoded = naclUtil.decodeBase64(ciphertext);

if (decoded.length < 12 + 16) {
  throw new Error('Ciphertext too short');
}

const cryptoKey = await crypto.subtle.importKey(
  'raw',
  sessionKey,
  'AES-GCM',
  false,
  ['decrypt']
);

// Try iOS / CryptoKit format first: nonce(12) + ciphertext + tag(16)
try {
  const iv = decoded.subarray(0, 12);
  const encrypted = decoded.subarray(12, decoded.length - 16);
  const tag = decoded.subarray(decoded.length - 16);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    concatUint8Arrays(encrypted, tag)
  );

  console.log('[decryptMessageForUserBrowser] decrypted using CryptoKit layout');
  return new TextDecoder().decode(decryptedBuffer);
} catch (iosErr) {
  console.warn('[decryptMessageForUserBrowser] CryptoKit layout failed, trying legacy layout', {
    error: iosErr?.message || iosErr,
  });
}

// Fallback: legacy web layout = nonce(12) + tag(16) + ciphertext
try {
  const iv = decoded.subarray(0, 12);
  const tag = decoded.subarray(12, 28);
  const encrypted = decoded.subarray(28);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    concatUint8Arrays(encrypted, tag)
  );

  console.log('[decryptMessageForUserBrowser] decrypted using legacy web layout');
  return new TextDecoder().decode(decryptedBuffer);
} catch (legacyErr) {
  console.error('[decryptMessageForUserBrowser] both ciphertext layouts failed', {
    iosTried: true,
    legacyError: legacyErr?.message || legacyErr,
  });
  throw legacyErr;
 }
}