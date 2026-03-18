import nacl from 'tweetnacl';
import * as util from 'tweetnacl-util';
import { saveKeysIDB, loadKeysIDB, clearKeysIDB } from './keyStore';

const FALLBACK_KEY = 'e2ee_keys';

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

  try {
    await saveKeysIDB(keys);
  } catch (e) {
    console.warn('IndexedDB failed, falling back to localStorage', e);
  }

  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(keys));
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
    return raw ? JSON.parse(raw) : { publicKey: null, privateKey: null };
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