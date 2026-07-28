import axiosClient from '@/api/axiosClient';
import {
  getLocalKeyBundleMeta,
  installLocalPrivateKeyBundle,
  validateAccountKeyBundle,
} from './encryptionClient.js';

const te = new TextEncoder();
const td = new TextDecoder();

function bytesToB64(bytes) {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(bytes)
    )
  );
}

function b64ToBytes(b64) {
  return Uint8Array.from(
    atob(b64),
    (c) => c.charCodeAt(0)
  );
}

async function fetchCurrentAccountPublicKey() {
  const { data } =
    await axiosClient.get('/auth/me');

  const user = data?.user ?? data;

  const publicKey =
    typeof user?.publicKey === 'string'
      ? user.publicKey.trim()
      : '';

  if (!publicKey) {
    throw new Error(
      'This account does not currently expose a secure message key.'
    );
  }

  return publicKey;
}

async function deriveWrapKey(
  password,
  saltB64,
  iterations
) {
  const salt = b64ToBytes(saltB64);

  const keyMaterial =
    await crypto.subtle.importKey(
      'raw',
      te.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesEncryptJson(
  obj,
  password
) {
  const salt =
    crypto.getRandomValues(
      new Uint8Array(16)
    );

  const iv =
    crypto.getRandomValues(
      new Uint8Array(12)
    );

  const iterations = 250_000;

  const key = await deriveWrapKey(
    password,
    bytesToB64(salt),
    iterations
  );

  const plaintext =
    te.encode(JSON.stringify(obj));

  const ciphertext =
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      plaintext
    );

  return {
    encryptedPrivateKeyBundle:
      JSON.stringify({
        ivB64: bytesToB64(iv),
        ctB64: bytesToB64(
          new Uint8Array(ciphertext)
        ),
      }),
    privateKeyWrapSalt:
      bytesToB64(salt),
    privateKeyWrapKdf:
      'PBKDF2-SHA256',
    privateKeyWrapIterations:
      iterations,
    privateKeyWrapVersion: 1,
  };
}

async function aesDecryptJson(
  bundle,
  password,
  saltB64,
  iterations
) {
  const parsed =
    typeof bundle === 'string'
      ? JSON.parse(bundle)
      : bundle;

  const key = await deriveWrapKey(
    password,
    saltB64,
    iterations
  );

  const plaintext =
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: b64ToBytes(
          parsed.ivB64
        ),
      },
      key,
      b64ToBytes(parsed.ctB64)
    );

  return JSON.parse(
    td.decode(plaintext)
  );
}

export async function uploadRemoteKeyBackup({
  publicKey,
  privateKey,
  password,
}) {
  if (
    !password ||
    password.trim().length < 8
  ) {
    throw new Error(
      'Secure Messages Passcode must be at least 8 characters.'
    );
  }

  const serverPublicKey =
    await fetchCurrentAccountPublicKey();

  const verified =
    validateAccountKeyBundle(
      {
        publicKey,
        privateKey,
      },
      serverPublicKey
    );

  const wrapped =
    await aesEncryptJson(
      verified,
      password.trim()
    );

  const { data } =
    await axiosClient.post(
      '/auth/keys/backup',
      {
        publicKey:
          verified.publicKey,
        ...wrapped,
      }
    );

  const saved =
    await fetchRemoteKeyBackup();

  if (
    !saved?.encryptedPrivateKeyBundle ||
    saved.publicKey?.trim() !==
      serverPublicKey
  ) {
    throw new Error(
      'The secure message recovery backup could not be verified.'
    );
  }

  return data;
}

export async function fetchRemoteKeyBackup() {
  const { data } =
    await axiosClient.get(
      '/auth/keys/backup'
    );

  return data?.keys || null;
}

export async function restoreRemoteKeyBackupToLocal({
  password,
}) {
  if (
    !password ||
    password.trim().length < 8
  ) {
    throw new Error(
      'Secure Messages Passcode must be at least 8 characters.'
    );
  }

  const serverPublicKey =
    await fetchCurrentAccountPublicKey();

  const keys =
    await fetchRemoteKeyBackup();

  if (!keys?.encryptedPrivateKeyBundle) {
    throw new Error(
      'No secure message recovery backup was found for this account.'
    );
  }

  if (
    !keys.publicKey ||
    keys.publicKey.trim() !==
      serverPublicKey
  ) {
    throw new Error(
      'The recovery backup does not match the current account secure message key.'
    );
  }

  const obj =
    await aesDecryptJson(
      keys.encryptedPrivateKeyBundle,
      password.trim(),
      keys.privateKeyWrapSalt,
      Number(
        keys.privateKeyWrapIterations ||
          250000
      )
    );

  const verified =
    validateAccountKeyBundle(
      obj,
      serverPublicKey
    );

  await installLocalPrivateKeyBundle(
    verified,
    password.trim(),
    serverPublicKey
  );

  const meta =
    await getLocalKeyBundleMeta();

  if (
    !meta?.publicKey ||
    meta.publicKey !== serverPublicKey
  ) {
    throw new Error(
      'Secure message restore could not be verified on this browser.'
    );
  }

  return verified;
}
