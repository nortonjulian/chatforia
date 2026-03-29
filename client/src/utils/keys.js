import nacl from 'tweetnacl';
import * as util from 'tweetnacl-util';
import { saveKeysIDB, loadKeysIDB, clearKeysIDB } from './keyStore';

const FALLBACK_KEY = 'e2ee_keys_public_only';

export function generateKeypair() {
  const kp = nacl.box.keyPair();
  return {
    publicKey: util.encodeBase64(kp.publicKey),
    privateKey: util.encodeBase64(kp.secretKey),
  };
}

export async function saveKeysLocal({ publicKey, privateKey }) {
  const keys = {
    publicKey: publicKey ?? null,
    privateKey: privateKey ?? null,
  };

  let savedToIDB = false;

  try {
    await saveKeysIDB(keys);
    savedToIDB = true;
  } catch (e) {
    console.warn(
      'IndexedDB failed. Private key will not be stored in localStorage fallback.',
      e
    );
  }

  try {
    if (!savedToIDB) {
      // Only persist the public key in fallback storage.
      // Never store the private key in localStorage.
      localStorage.setItem(
        FALLBACK_KEY,
        JSON.stringify({
          publicKey: keys.publicKey,
          privateKey: null,
        })
      );
    } else {
      localStorage.removeItem(FALLBACK_KEY);
    }
  } catch (e) {
    console.warn('localStorage fallback save failed', e);
  }
}

export async function loadKeysLocal() {
  try {
    const keys = await loadKeysIDB();
    if (keys?.publicKey || keys?.privateKey) return keys;
  } catch (e) {
    console.warn('IndexedDB load failed, trying localStorage', e);
  }

  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) {
      return { publicKey: null, privateKey: null };
    }

    const parsed = JSON.parse(raw);
    return {
      publicKey: parsed?.publicKey ?? null,
      privateKey: null, // never load private key from localStorage
    };
  } catch (e) {
    console.warn('localStorage fallback load failed', e);
    return { publicKey: null, privateKey: null };
  }
}

export async function clearKeysLocal() {
  try {
    await clearKeysIDB();
  } catch (e) {
    console.warn('IndexedDB clear failed', e);
  }

  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch (e) {
    console.warn('localStorage fallback clear failed', e);
  }
}