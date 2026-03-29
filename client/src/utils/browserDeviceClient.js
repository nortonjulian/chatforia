import { get, set, del } from 'idb-keyval';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const DEVICE_REC_KEY = 'chatforia:browserDevice:v1';

function bytesToB64(bytes) {
  return naclUtil.encodeBase64(bytes);
}

function b64ToBytes(b64) {
  return naclUtil.decodeBase64(b64);
}

export async function getBrowserDeviceRecord() {
  return (await get(DEVICE_REC_KEY)) || null;
}

export async function getOrCreateBrowserDeviceRecord() {
  const existing = await getBrowserDeviceRecord();
  if (existing?.deviceId && existing?.publicKey && existing?.privateKey) {
    return existing;
  }

  const kp = nacl.box.keyPair();
  const record = {
    version: 1,
    createdAt: new Date().toISOString(),
    deviceId: crypto.randomUUID().toLowerCase(),
    name: getBrowserName(),
    platform: getBrowserPlatform(),
    publicKey: bytesToB64(kp.publicKey),
    privateKey: bytesToB64(kp.secretKey),
    keyAlgorithm: 'curve25519',
    keyVersion: 1,
  };

  await set(DEVICE_REC_KEY, record);
  return record;
}

export async function clearBrowserDeviceRecord() {
  await del(DEVICE_REC_KEY);
}

export async function getBrowserDevicePrivateKeyBytes() {
  const rec = await getBrowserDeviceRecord();
  if (!rec?.privateKey) return null;
  return b64ToBytes(rec.privateKey);
}

export async function getBrowserDevicePublicKey() {
  const rec = await getBrowserDeviceRecord();
  return rec?.publicKey || null;
}

function getBrowserName() {
  const ua = navigator.userAgent || 'Browser';
  if (ua.includes('Chrome')) return 'Chrome Browser';
  if (ua.includes('Firefox')) return 'Firefox Browser';
  if (ua.includes('Safari')) return 'Safari Browser';
  if (ua.includes('Edg')) return 'Edge Browser';
  return 'Browser';
}

function getBrowserPlatform() {
  const ua = navigator.userAgent || 'Web';
  return ua.slice(0, 120);
}