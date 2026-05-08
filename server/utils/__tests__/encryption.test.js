import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

const repeatBuf = (ch, len) => Buffer.from(ch.repeat(len));

function makeCryptoMock() {
  const createDecipheriv = jest.fn((_alg, key, iv) => {
    return {
      _key: key,
      _iv: iv,
      setAuthTag: jest.fn(() => {}),
      update: jest.fn(() => Buffer.from('PLAINTEXT')),
      final: jest.fn(() => Buffer.from('')),
    };
  });

  return { createDecipheriv };
}

function makeNaclMock() {
  const encodeBase64 = jest.fn((bytes) => {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return buf.toString('base64');
  });

  const decodeBase64 = jest.fn((b64) => {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  });

  const keyPair = {
    publicKey: Uint8Array.from([1, 2, 3]),
    secretKey: Uint8Array.from([4, 5, 6]),
  };

  const boxKeyPair = jest.fn(() => keyPair);

  const boxOpen = jest.fn((boxData) => {
    const buf = Buffer.from(boxData);
    const prefix = Buffer.from('BOX|');

    if (!buf.slice(0, 4).equals(prefix)) return null;

    return Uint8Array.from(buf.slice(4));
  });

  return {
    nacl: {
      box: {
        keyPair: boxKeyPair,
        open: boxOpen,
      },
    },
    naclUtil: {
      encodeBase64,
      decodeBase64,
    },
  };
}

async function loadEncryption() {
  jest.resetModules();

  const { createDecipheriv } = makeCryptoMock();

  jest.unstable_mockModule('crypto', () => ({
    __esModule: true,
    default: {
      createDecipheriv,
    },
    createDecipheriv,
  }));

  const { nacl, naclUtil } = makeNaclMock();

  jest.unstable_mockModule('tweetnacl', () => ({
    __esModule: true,
    default: nacl,
    ...nacl,
  }));

  jest.unstable_mockModule('tweetnacl-util', () => ({
    __esModule: true,
    default: naclUtil,
    ...naclUtil,
  }));

  const mod = await import('../encryption.js');

  return {
    mod,
    mocks: {
      createDecipheriv,
      nacl,
      naclUtil,
    },
  };
}

describe('generateKeyPair', () => {
  test('returns base64-encoded public/private keys from nacl.box.keyPair()', async () => {
    const { mod, mocks } = await loadEncryption();

    const kp = mod.generateKeyPair();

    expect(kp).toEqual({
      publicKey: Buffer.from([1, 2, 3]).toString('base64'),
      privateKey: Buffer.from([4, 5, 6]).toString('base64'),
    });

    expect(mocks.nacl.box.keyPair).toHaveBeenCalledTimes(1);
    expect(mocks.naclUtil.encodeBase64).toHaveBeenCalledWith(
      Uint8Array.from([1, 2, 3])
    );
    expect(mocks.naclUtil.encodeBase64).toHaveBeenCalledWith(
      Uint8Array.from([4, 5, 6])
    );
  });
});

describe('decryptMessageForUser', () => {
  test('successfully opens session key via nacl.box.open and decrypts message to utf8 string', async () => {
    const { mod, mocks } = await loadEncryption();

    const nonce = repeatBuf('N', 24);
    const boxed = Buffer.concat([
      Buffer.from('BOX|'),
      repeatBuf('K', 32),
    ]);

    const encryptedSessionKeyB64 = Buffer.concat([nonce, boxed]).toString(
      'base64'
    );

    const iv = repeatBuf('I', 12);
    const tag = repeatBuf('T', 16);
    const encBuf = Buffer.from('encrypted-body');

    const ciphertextB64 = Buffer.concat([iv, tag, encBuf]).toString('base64');

    const currentUserPrivateKey = Buffer.from('private-key').toString('base64');
    const senderPublicKey = Buffer.from('sender-public-key').toString('base64');

    const pt = mod.decryptMessageForUser(
      ciphertextB64,
      encryptedSessionKeyB64,
      currentUserPrivateKey,
      senderPublicKey
    );

    expect(pt).toBe('PLAINTEXT');
    expect(mocks.nacl.box.open).toHaveBeenCalledTimes(1);
    expect(mocks.createDecipheriv).toHaveBeenCalledTimes(1);
  });

  test('throws if nacl.box.open returns null', async () => {
    const { mod, mocks } = await loadEncryption();

    mocks.nacl.box.open.mockReturnValueOnce(null);

    const badEncryptedKey = Buffer.concat([
      repeatBuf('N', 24),
      Buffer.from('BAD_BOX_DATA'),
    ]).toString('base64');

    const someCipher = Buffer.concat([
      repeatBuf('I', 12),
      repeatBuf('T', 16),
      Buffer.from('encrypted-body'),
    ]).toString('base64');

    const currentUserPrivateKey = Buffer.from('private-key').toString('base64');
    const senderPublicKey = Buffer.from('sender-public-key').toString('base64');

    expect(() =>
      mod.decryptMessageForUser(
        someCipher,
        badEncryptedKey,
        currentUserPrivateKey,
        senderPublicKey
      )
    ).toThrow('Unable to decrypt session key');
  });
});