import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const mockRecords = new Map();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key) => mockRecords.get(key)),
  set: jest.fn(async (key, value) => { mockRecords.set(key, value); }),
  del: jest.fn(async (key) => { mockRecords.delete(key); }),
}));

import {
  installLocalPrivateKeyBundle,
  lockKeyBundle,
  getUnlockedPrivateKeyForPublicKey,
  unlockTrustedBrowserBundle,
  clearLocalKeyBundle,
} from '../encryptionClient';

test('a browser can reopen its verified key after memory and session state are cleared', async () => {
  const pair = nacl.box.keyPair();
  const publicKey = naclUtil.encodeBase64(pair.publicKey);
  const privateKey = naclUtil.encodeBase64(pair.secretKey);

  try {
    await installLocalPrivateKeyBundle({ publicKey, privateKey }, 'recovery passcode', publicKey);
    lockKeyBundle();
    sessionStorage.clear();

    expect(await unlockTrustedBrowserBundle('another account')).toBe(false);
    expect(await unlockTrustedBrowserBundle(publicKey)).toBe(true);
    expect(await getUnlockedPrivateKeyForPublicKey(publicKey)).toBe(privateKey);
  } finally {
    await clearLocalKeyBundle();
    sessionStorage.clear();
    mockRecords.clear();
  }
});
