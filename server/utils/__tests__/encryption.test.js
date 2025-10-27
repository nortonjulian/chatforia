const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

// helpers to build deterministic Buffers
const repeatBuf = (ch, len) => Buffer.from(ch.repeat(len));

function makeCryptoMock() {
  // Deterministic randomBytes
  const randomBytes = jest.fn((len) => {
    if (len === 32) return repeatBuf('K', 32); // session key
    if (len === 12) return repeatBuf('I', 12); // iv
    if (len === 24) return repeatBuf('N', 24); // nonce
    throw new Error('unexpected randomBytes len ' + len);
  });

  // Cipher mock
  const createCipheriv = jest.fn((_alg, key, iv) => {
    return {
      _key: key,
      _iv: iv,
      update: jest.fn((plaintext /*, 'utf8' */) =>
        Buffer.from(`E(${plaintext})`)
      ),
      final: jest.fn(() => Buffer.from('F')),
      getAuthTag: jest.fn(() => repeatBuf('T', 16)),
    };
  });

  // Decipher mock
  const createDecipheriv = jest.fn((_alg, key, iv) => {
    return {
      _key: key,
      _iv: iv,
      setAuthTag: jest.fn(() => {}),
      update: jest.fn((encBuf) => {
        // encBuf should be Buffer.from(`E(${message})F`) minus the 'F' split,
        // but we won't parse realistically. We'll just map it back to a canned value.
        // We'll assert the final return of decryptMessageForUser() anyway.
        return Buffer.from('PLAINTEXT');
      }),
      final: jest.fn(() => Buffer.from('')),
    };
  });

  return { randomBytes, createCipheriv, createDecipheriv };
}

// We'll need a consistent nacl + naclUtil mock
function makeNaclMock() {
  // We'll encode keys as base64 strings like 'PUB_user1', etc.
  // decodeBase64() will just turn base64 text into Uint8Array([...charCodes...])
  const decodeBase64 = jest.fn((b64) => {
    return Uint8Array.from(Buffer.from(b64, 'utf8'));
  });

  const encodeBase64 = jest.fn((bytes) => {
    // bytes may be Buffer or Uint8Array
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return `b64(${buf.toString('hex')})`;
  });

  const keyPair = {
    publicKey: Uint8Array.from([1, 2, 3]),
    secretKey: Uint8Array.from([4, 5, 6]),
  };

  const boxKeyPair = jest.fn(() => keyPair);

  // nacl.box(msgU8, nonceU8, recipientPubU8, senderSecU8)
  // We'll just return Uint8Array of: "BOX|" + sessionKeyBytesHex
  const box = jest.fn((msgU8 /* sessionKey */, nonceU8, recipPub, senderSec) => {
    // build a deterministic "cipher" payload
    const prefix = Buffer.from('BOX|');
    const payload = Buffer.from(msgU8); // the session key bytes
    return Uint8Array.from(Buffer.concat([prefix, payload]));
  });

  // nacl.box.open(boxData, nonce, senderPubU8, currentUserPrivU8)
  // We'll just unwrap after 'BOX|'
  const boxOpen = jest.fn((boxData /* Uint8Array */, nonce, senderPub, curPriv) => {
    // if we get a Uint8Array starting with 'BOX|', return the rest
    const buf = Buffer.from(boxData);
    const prefix = Buffer.from('BOX|');
    if (!buf.slice(0, 4).equals(prefix)) {
      return null;
    }
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

// loader without pool (pool=null)
async function loadEncryptionNoPool() {
  jest.resetModules();

  // crypto mock
  const { randomBytes, createCipheriv, createDecipheriv } = makeCryptoMock();
  jest.unstable_mockModule('crypto', () => ({
    default: { randomBytes, createCipheriv, createDecipheriv },
    randomBytes,
    createCipheriv,
    createDecipheriv,
  }));

  // nacl / util mock
  const { nacl, naclUtil } = makeNaclMock();
  jest.unstable_mockModule('tweetnacl', () => ({
    default: nacl,
    ...nacl,
  }));
  jest.unstable_mockModule('tweetnacl-util', () => naclUtil);

  // mock cryptoPool.js so import fails gracefully -> pool stays null
  jest.unstable_mockModule('../../services/cryptoPool.js', () => {
    throw new Error('no pool');
  });

  const mod = await import('../../utils/encryption.js');
  return { mod, mocks: { randomBytes, createCipheriv, createDecipheriv, nacl, naclUtil } };
}

// loader with pool (>= threshold)
async function loadEncryptionWithPool({ runImpl }) {
  jest.resetModules();

  // crypto mock
  const { randomBytes, createCipheriv, createDecipheriv } = makeCryptoMock();
  jest.unstable_mockModule('crypto', () => ({
    default: { randomBytes, createCipheriv, createDecipheriv },
    randomBytes,
    createCipheriv,
    createDecipheriv,
  }));

  // nacl / util mock
  const { nacl, naclUtil } = makeNaclMock();
  jest.unstable_mockModule('tweetnacl', () => ({
    default: nacl,
    ...nacl,
  }));
  jest.unstable_mockModule('tweetnacl-util', () => naclUtil);

  // set parallel threshold low so we trigger pool path
  process.env.ENCRYPT_PARALLEL_THRESHOLD = '2';

  const poolMock = {
    run: jest.fn(runImpl),
  };

  jest.unstable_mockModule('../../services/cryptoPool.js', () => ({
    getCryptoPool: () => poolMock,
  }));

  const mod = await import('../../utils/encryption.js');
  return { mod, poolMock, mocks: { randomBytes, createCipheriv, createDecipheriv, nacl, naclUtil } };
}

describe('generateKeyPair', () => {
  test('returns base64-encoded public/private keys from nacl.box.keyPair()', async () => {
    const { mod, mocks } = await loadEncryptionNoPool();
    const { generateKeyPair } = mod;

    const kp = generateKeyPair();

    // We mocked nacl.box.keyPair() to return { publicKey:[1,2,3], secretKey:[4,5,6] }
    // We mocked encodeBase64(bytes) to return `b64(<hex>)`
    expect(kp).toEqual({
      publicKey: 'b64(010203)',
      privateKey: 'b64(040506)',
    });

    // Ensure encodeBase64 was called with those exact Uint8Arrays
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
      { id: 222, publicKey: 'PUB_222_DUP' }, // duplicate id, should be ignored
      { id: null, publicKey: 'NOPE' },       // invalid
    ];

    const result = await encryptMessageForParticipants(
      'hello secret world',
      sender,
      recipients
    );

    // --- ciphertext structure ---
    // Our mock crypto does:
    //  sessionKey = 32 x 'K'
    //  iv = 12 x 'I'
    //  tag = 16 x 'T'
    //  enc = Buffer("E(<plaintext>)" + "F") basically
    //
    // encryptMessageForParticipants encodes Buffer.concat([iv, tag, enc]).toString('base64')
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

    // --- encryptedKeys ---
    // For each unique valid recipient AND the sender
    // sealKeyInline builds:
    //   nonce = 24 x 'N'
    //   boxed = nacl.box(sessionKeyU8,...)
    // Our nacl.box returns Uint8Array("BOX|" + sessionKeyBytes)
    //
    // sessionKeyBytes is 32 x 'K'
    const nonce = repeatBuf('N', 24);
    const boxed = Buffer.concat([
      Buffer.from('BOX|'),
      repeatBuf('K', 32),
    ]);
    const packed = Buffer.concat([nonce, boxed]);
    const sealedExpected = `b64(${packed.toString('hex')})`;

    // Should include for 222, 333, and the sender.id (111)
    expect(Object.keys(result.encryptedKeys).sort()).toEqual(
      ['111', '222', '333']
    );

    expect(result.encryptedKeys['222']).toBe(sealedExpected);
    expect(result.encryptedKeys['333']).toBe(sealedExpected);
    expect(result.encryptedKeys['111']).toBe(sealedExpected);

    // We should have called nacl.box(...) once per unique seal in inline mode.
    // That means for 222, 333, and sender self.
    // We can't trivially assert exact arguments (they're Uint8Arrays from decodeBase64),
    // but we CAN assert call count.
    expect(mocks.nacl.box).toHaveBeenCalledTimes(3);

    // Ensure crypto.createCipheriv called once total (message encrypted once)
    expect(mocks.createCipheriv).toHaveBeenCalledTimes(1);
  });
});

describe('encryptMessageForParticipants (with pool and threshold hit)', () => {
  test('uses pool.run when recipient count >= PARALLEL_THRESHOLD and falls back inline on pool error', async () => {
    // We'll force PARALLEL_THRESHOLD=2 in loader, so 3 unique recipients triggers pool path.
    const { mod, poolMock } = await loadEncryptionWithPool({
      runImpl: jest
        .fn()
        .mockImplementationOnce(async ({ recipientPubB64, msgKeyB64, senderSecretB64 }) => {
          // first recipient succeeds with pool
          return { sealedKeyB64: 'SEALED_FROM_POOL_1' };
        })
        .mockImplementationOnce(async () => {
          // second recipient succeeds with pool
          return { sealedKeyB64: 'SEALED_FROM_POOL_2' };
        })
        .mockImplementationOnce(async () => {
          // third recipient throws -> should fallback inline
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

    // We expect encryptedKeys for recipients 1,2,3 + sender 10
    const ids = Object.keys(result.encryptedKeys).sort();
    expect(ids).toEqual(['1', '10', '2', '3']);

    // First two should come from pool return values
    expect(result.encryptedKeys['1']).toBe('SEALED_FROM_POOL_1');
    expect(result.encryptedKeys['2']).toBe('SEALED_FROM_POOL_2');

    // Third recipient used fallback -> should look like our inline sealedKey style "b64(...)".
    expect(result.encryptedKeys['3']).toMatch(/^b64\(/);

    // Sender should also always get a sealed key
    expect(result.encryptedKeys['10']).toMatch(/^b64\(/);

    // pool.run should have been called 3 times (once per unique recipient)
    expect(poolMock.run).toHaveBeenCalledTimes(3);
  });
});

describe('decryptMessageForUser', () => {
  test('successfully opens session key via nacl.box.open and decrypts message to utf8 string', async () => {
    const { mod, mocks } = await loadEncryptionNoPool();
    const { decryptMessageForUser } = mod;

    // Build an encryptedSessionKey that matches what encrypt() produced
    // Format: base64([nonce(24) | "BOX|" + sessionKeyBytes])
    const nonce = repeatBuf('N', 24);
    const boxed = Buffer.concat([
      Buffer.from('BOX|'),
      repeatBuf('K', 32), // same mock session key
    ]);
    const packed = Buffer.concat([nonce, boxed]);
    const encryptedSessionKeyB64 = `b64(${packed.toString('hex')})`;

    // ciphertext: base64([iv(12) | tag(16) | encBuf("E(hi)F")])
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

    // decryptMessageForUser mock path returns "PLAINTEXT" from decipher mocks
    expect(pt).toBe('PLAINTEXT');

    // nacl.box.open should have been called once with Uint8Arrays
    expect(mocks.nacl.box.open).toHaveBeenCalledTimes(1);

    // createDecipheriv should have been called once after successful box.open
    expect(mocks.createDecipheriv).toHaveBeenCalledTimes(1);
  });

  test('throws if nacl.box.open returns null (cannot decrypt session key)', async () => {
    const { mod, mocks } = await loadEncryptionNoPool();
    const { decryptMessageForUser } = mod;

    // Force box.open to fail
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
