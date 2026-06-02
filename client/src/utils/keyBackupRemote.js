import axiosClient from '@/api/axiosClient';
import { installLocalPrivateKeyBundle } from './encryptionClient.js';

const te = new TextEncoder();
const td = new TextDecoder();

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveWrapKey(password, saltB64, iterations) {
  const salt = b64ToBytes(saltB64);

  const keyMaterial = await crypto.subtle.importKey(
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
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesEncryptJson(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 250_000;

  const key = await deriveWrapKey(password, bytesToB64(salt), iterations);

  const plaintext = te.encode(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return {
    encryptedPrivateKeyBundle: JSON.stringify({
      ivB64: bytesToB64(iv),
      ctB64: bytesToB64(new Uint8Array(ciphertext)),
    }),
    privateKeyWrapSalt: bytesToB64(salt),
    privateKeyWrapKdf: 'PBKDF2-SHA256',
    privateKeyWrapIterations: iterations,
    privateKeyWrapVersion: 1,
  };
}

async function aesDecryptJson(bundle, password, saltB64, iterations) {
  const parsed = typeof bundle === 'string' ? JSON.parse(bundle) : bundle;

  const key = await deriveWrapKey(password, saltB64, iterations);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(parsed.ivB64) },
    key,
    b64ToBytes(parsed.ctB64)
  );

  return JSON.parse(td.decode(plaintext));
}

export async function uploadRemoteKeyBackup({
  publicKey,
  privateKey,
  password,
}) {
  if (!publicKey || !privateKey) {
    throw new Error('Missing keypair for backup');
  }

  if (!password || password.trim().length < 8) {
    throw new Error('Recovery Passcode must be at least 8 characters.');
  }

  const wrapped = await aesEncryptJson(
    {
      publicKey,
      privateKey,
    },
    password.trim()
  );

  const { data } = await axiosClient.post('/auth/keys/backup', {
    publicKey,
    ...wrapped,
  });

  return data;
}

export async function fetchRemoteKeyBackup() {
  const { data } = await axiosClient.get('/auth/keys/backup');
  return data?.keys || null;
}

export async function restoreRemoteKeyBackupToLocal({ password }) {
  if (!password || password.trim().length < 8) {
    throw new Error('Recovery Passcode must be at least 8 characters.');
  }

  const keys = await fetchRemoteKeyBackup();

  if (!keys?.encryptedPrivateKeyBundle) {
    throw new Error('No remote key backup found');
  }

  const obj = await aesDecryptJson(
    keys.encryptedPrivateKeyBundle,
    password.trim(),
    keys.privateKeyWrapSalt,
    keys.privateKeyWrapIterations
  );

  if (!obj?.publicKey || !obj?.privateKey) {
    throw new Error('Remote key backup is invalid');
  }

  await installLocalPrivateKeyBundle({
    publicKey: obj.publicKey,
    privateKey: obj.privateKey,
  });

  return obj;
}