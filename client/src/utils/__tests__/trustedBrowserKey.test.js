import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const mockRecords = new Map();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key) => mockRecords.get(key)),
  set: jest.fn(async (key, value) => { mockRecords.set(key, value); }),
  del: jest.fn(async (key) => { mockRecords.delete(key); }),
}));
jest.mock('../keys.js', () => ({
  loadKeysLocal: jest.fn(async () => ({ publicKey: null, privateKey: null })),
  clearKeysLocal: jest.fn(async () => {}),
}));

import { loadKeysLocal } from '../keys.js';
import {
  installLocalPrivateKeyBundle,
  lockKeyBundle,
  getUnlockedPrivateKeyForPublicKey,
  unlockTrustedBrowserBundle,
  clearLocalKeyBundle,
  getLocalKeyBundleMeta,
} from '../encryptionClient';

afterEach(() => {
  loadKeysLocal.mockResolvedValue({ publicKey: null, privateKey: null });
});

test('an existing browser key remains available after a new sign-in', async () => {
  const pair = nacl.box.keyPair();
  const publicKey = naclUtil.encodeBase64(pair.publicKey);
  const privateKey = naclUtil.encodeBase64(pair.secretKey);
  loadKeysLocal.mockResolvedValue({ publicKey, privateKey });

  expect(await getLocalKeyBundleMeta()).toMatchObject({
    version: 'trusted-device', publicKey, hasEncrypted: false,
  });
  lockKeyBundle();
  expect(await getUnlockedPrivateKeyForPublicKey(publicKey)).toBe(privateKey);
});

test('a browser can reopen its verified key after memory and session state are cleared', async () => {
  const pair = nacl.box.keyPair();
  const publicKey = naclUtil.encodeBase64(pair.publicKey);
  const privateKey = naclUtil.encodeBase64(pair.secretKey);

  try {
    await installLocalPrivateKeyBundle({ publicKey, privateKey }, 'recovery passcode', publicKey);
    // A stale key in the older store cannot override the current bundle.
    loadKeysLocal.mockResolvedValue({ publicKey: 'stale', privateKey: 'stale' });
    lockKeyBundle();
    sessionStorage.clear();

    expect(await getLocalKeyBundleMeta()).toMatchObject({ publicKey, hasEncrypted: true });
    expect(await unlockTrustedBrowserBundle('another account')).toBe(false);
    expect(await unlockTrustedBrowserBundle(publicKey)).toBe(true);
    expect(await getUnlockedPrivateKeyForPublicKey(publicKey)).toBe(privateKey);
  } finally {
    await clearLocalKeyBundle();
    sessionStorage.clear();
    mockRecords.clear();
  }
});
