import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

// helper: deterministic buffer filler
const repeatBuf = (ch, len) => Buffer.from(ch.repeat(len));

function makeCryptoMock() {
  const randomBytes = jest.fn((len) => {
    if (len === 32) return repeatBuf('K', 32); // session key
    if (len === 12) return repeatBuf('I', 12); // IV
    if (len === 24) return repeatBuf('N', 24); // nonce
    throw new Error('unexpected randomBytes len ' + len);
  });

  const createCipheriv = jest.fn((_alg, key, iv) => {
    return {
      _key: key,
      _iv: iv,
      update: jest.fn((plaintext) => Buffer.from(`E(${plaintext})`)),
      final: jest.fn(() => Buffer.from('F')),
      getAuthTag: jest.fn(() => repeatBuf('T', 16)),
    };
  });

  const createDecipheriv = jest.fn((_alg, key, iv) => {
    return {
      _key: key,
      _iv: iv,
      setAuthTag: jest.fn(() => {}),
      update: jest.fn(() => Buffer.from('PLAINTEXT')),
      final: jest.fn(() => Buffer.from('')),
    };
  });

  return { randomBytes, createCipheriv, createDecipheriv };
}

function makeNaclMock() {
  // encodeBase64: b64(<hex>)
  const encodeBase64 = jest.fn((bytes) => {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return `b64(${buf.toString('hex')})`;
  });

  // UPDATED decodeBase64:
  // - if string looks like b64(<hex>), decode that hex back to bytes
  // - else just treat input string bytes
  const decodeBase64 = jest.fn((b64) => {
    const m = /^b64\(([0-9a-fA-F]+)\)$/.exec(b64);
    if (m) {
      const hex = m[1];
      const buf = Buffer.from(hex, 'hex');
      return Uint8Array.from(buf);
    }
    // fallback: interpret raw string as bytes
    return Uint8Array.from(Buffer.from(b64, 'utf8'));
  });

  const keyPair = {
    publicKey: Uint8Array.from([1, 2, 3]),
    secretKey: Uint8Array.from([4, 5, 6]),
  };

  const boxKeyPair = jest.fn(() => keyPair);

  // nacl.box(msgU8,...)
  const box = jest.fn((msgU8) => {
    const prefix = Buffer.from('BOX|');
    const payload = Buffer.from(msgU8);
    return Uint8Array.from(Buffer.concat([prefix, payload]));
  });

  // nacl.box.open(...)
  // returns Uint8Array of the "payload after BOX|" or null on mismatch
  const boxOpen = jest.fn((boxData) => {
    const buf = Buffer.from(boxData);
    const prefix = Buffer.from('BOX|');
    if (!buf.slice(0, 4).equals(prefix)) return null;
    const rest = buf.slice(4);
    return Uint8Array.from(rest);
  });

  return {
    nacl: {
      box: Object.assign(box, { keyPair: boxKeyPair, open: boxOpen }),
    },
    naclUtil: {
      encodeBase64,
      decodeBase64,
    },
  };
}

/**
 * Loader WITHOUT pool:
 * - mock crypto
 * - mock tweetnacl & tweetnacl-util
 * - mock ../services/cryptoPool.js -> null pool
 * - import ../encryption.js
 */
async function loadEncryptionNoPool() {
  jest.resetModules();

  const { randomBytes, createCipheriv, createDecipheriv } = makeCryptoMock();
  jest.unstable_mockModule('crypto', () => ({
    default: { randomBytes, createCipheriv, createDecipheriv },
    randomBytes,
    createCipheriv,
    createDecipheriv,
  }));

  const { nacl, naclUtil } = makeNaclMock();
  jest.unstable_mockModule('tweetnacl', () => ({
    default: nacl,
    ...nacl,
  }));
  jest.unstable_mockModule('tweetnacl-util', () => ({
    default: naclUtil,
    ...naclUtil,
  }));

  jest.unstable_mockModule('../services/cryptoPool.js', () => ({
    getCryptoPool: () => null,
  }));

  const mod = await import('../encryption.js');
  return {
    mod,
    mocks: { randomBytes, createCipheriv, createDecipheriv, nacl, naclUtil },
  };
}

/**
 * Loader WITH pool:
 * - same mocks
 * - cryptoPool returns fake pool with run()
 * - sets ENCRYPT_PARALLEL_THRESHOLD='2' so pool path triggers
 */
async function loadEncryptionWithPool({ runImpl }) {
  jest.resetModules();

  const { randomBytes, createCipheriv, createDecipheriv } = makeCryptoMock();
  jest.unstable_mockModule('crypto', () => ({
    default: { randomBytes, createCipheriv, createDecipheriv },
    randomBytes,
    createCipheriv,
    createDecipheriv,
  }));

  const { nacl, naclUtil } = makeNaclMock();
  jest.unstable_mockModule('tweetnacl', () => ({
    default: nacl,
    ...nacl,
  }));
  jest.unstable_mockModule('tweetnacl-util', () => ({
    default: naclUtil,
    ...naclUtil,
  }));

  process.env.ENCRYPT_PARALLEL_THRESHOLD = '2';

  const poolMock = {
    run: jest.fn(runImpl),
  };

  jest.unstable_mockModule('../services/cryptoPool.js', () => ({
    getCryptoPool: () => poolMock,
  }));

  const mod = await import('../encryption.js');
  return {
    mod,
    poolMock,
    mocks: { randomBytes, createCipheriv, createDecipheriv, nacl, naclUtil },
  };
}

/* ---------------- TESTS ---------------- */

describe('generateKeyPair', () => {
  test('returns base64-encoded public/private keys from nacl.box.keyPair()', async () => {
    const { mod, mocks } = await loadEncryptionNoPool();
    const { generateKeyPair } = mod;

    const kp = generateKeyPair();

    expect(kp).toEqual({
      publicKey: 'b64(010203)',
      privateKey: 'b64(040506)',
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

describe('encryptMessageForParticipants (no pool / inline sealing)', () => {
  test('encrypts once with AES-GCM, dedupes recipients, seals session key for each recipient and sender', async () => {
    const { mod, mocks } = await loadEncryptionNoPool();
    const { encryptMessageForParticipants } = mod;

    const sender = {
      id: 111,
      publicKey: 'PUB_SENDER',
      privateKey: 'PRIV_SENDER',
    };

    const recipients = [
      { id: 222, publicKey: 'PUB_222' },
      { id: 333, publicKey: 'PUB_333' },
      { id: 222, publicKey: 'PUB_222_DUP' }, // dup -> skip
      { id: null, publicKey: 'NOPE' },       // invalid -> skip
    ];

    const result = await encryptMessageForParticipants(
      'hello secret world',
      sender,
      recipients
    );

    const expectedIv = repeatBuf('I', 12);
    const expectedTag = repeatBuf('T', 16);
    const expectedEnc = Buffer.concat([
      Buffer.from('E(hello secret world)'),
      Buffer.from('F'),
    ]);
    const expectedCipherBuf = Buffer.concat([
      expectedIv,
      expectedTag,
      expectedEnc,
    ]);
    const expectedCipherB64 = expectedCipherBuf.toString('base64');

    expect(result.ciphertext).toBe(expectedCipherB64);

    const nonce = repeatBuf('N', 24);
    const boxed = Buffer.concat([
      Buffer.from('BOX|'),
      repeatBuf('K', 32),
    ]);
    const packed = Buffer.concat([nonce, boxed]);
    const sealedExpected = `b64(${packed.toString('hex')})`;

    expect(Object.keys(result.encryptedKeys).sort()).toEqual(
      ['111', '222', '333']
    );
    expect(result.encryptedKeys['222']).toBe(sealedExpected);
    expect(result.encryptedKeys['333']).toBe(sealedExpected);
    expect(result.encryptedKeys['111']).toBe(sealedExpected);

    expect(mocks.nacl.box).toHaveBeenCalledTimes(3);
    expect(mocks.createCipheriv).toHaveBeenCalledTimes(1);
  });
});

describe('encryptMessageForParticipants (with pool and threshold hit)', () => {
  test('uses pool.run when recipient count >= PARALLEL_THRESHOLD and falls back inline on pool error', async () => {
    const { mod, poolMock } = await loadEncryptionWithPool({
      runImpl: jest
        .fn()
        .mockImplementationOnce(async () => {
          return { sealedKeyB64: 'SEALED_FROM_POOL_1' };
        })
        .mockImplementationOnce(async () => {
          return { sealedKeyB64: 'SEALED_FROM_POOL_2' };
        })
        .mockImplementationOnce(async () => {
          throw new Error('worker fail');
        }),
    });

    const { encryptMessageForParticipants } = mod;

    const sender = {
      id: 10,
      publicKey: 'PUB_SENDER',
      privateKey: 'PRIV_SENDER',
    };

    const recipients = [
      { id: 1, publicKey: 'PUB_1' },
      { id: 2, publicKey: 'PUB_2' },
      { id: 3, publicKey: 'PUB_3' },
    ];

    const result = await encryptMessageForParticipants(
      'hi everyone',
      sender,
      recipients
    );

    const ids = Object.keys(result.encryptedKeys).sort();
    expect(ids).toEqual(['1', '10', '2', '3']);

    expect(result.encryptedKeys['1']).toBe('SEALED_FROM_POOL_1');
    expect(result.encryptedKeys['2']).toBe('SEALED_FROM_POOL_2');

    expect(result.encryptedKeys['3']).toMatch(/^b64\(/);
    expect(result.encryptedKeys['10']).toMatch(/^b64\(/);

    expect(poolMock.run).toHaveBeenCalledTimes(3);
  });
});

describe('decryptMessageForUser', () => {
  test('successfully opens session key via nacl.box.open and decrypts message to utf8 string', async () => {
    const { mod, mocks } = await loadEncryptionNoPool();
    const { decryptMessageForUser } = mod;

    // build encryptedSessionKeyB64 exactly like encrypt() pack:
    // packed = [nonce(24x'N') | "BOX|" | 32x'K']
    const nonce = repeatBuf('N', 24);
    const boxed = Buffer.concat([
      Buffer.from('BOX|'),
      repeatBuf('K', 32),
    ]);
    const packed = Buffer.concat([nonce, boxed]);
    const encryptedSessionKeyB64 = `b64(${packed.toString('hex')})`;

    const iv = repeatBuf('I', 12);
    const tag = repeatBuf('T', 16);
    const encBuf = Buffer.concat([
      Buffer.from('E(hi)'),
      Buffer.from('F'),
    ]);
    const cipherBuf = Buffer.concat([iv, tag, encBuf]);
    const ciphertextB64 = cipherBuf.toString('base64');

    const pt = decryptMessageForUser(
      ciphertextB64,
      encryptedSessionKeyB64,
      'PRIV_CURRENT_USER',
      'PUB_SENDER_USER'
    );

    expect(pt).toBe('PLAINTEXT');
    expect(mocks.nacl.box.open).toHaveBeenCalledTimes(1);
    expect(mocks.createDecipheriv).toHaveBeenCalledTimes(1);
  });

  test('throws if nacl.box.open returns null (cannot decrypt session key)', async () => {
    const { mod, mocks } = await loadEncryptionNoPool();
    const { decryptMessageForUser } = mod;

    // force failure
    mocks.nacl.box.open.mockReturnValueOnce(null);

    const badEncryptedKey = 'b64(badkeyblob)';
    const someCipher = Buffer.concat([
      repeatBuf('I', 12),
      repeatBuf('T', 16),
      Buffer.from('E(msg)F'),
    ]).toString('base64');

    expect(() =>
      decryptMessageForUser(
        someCipher,
        badEncryptedKey,
        'PRIV_CUR',
        'PUB_SEND'
      )
    ).toThrow('Unable to decrypt session key');
  });
});
