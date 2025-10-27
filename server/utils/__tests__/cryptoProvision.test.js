import { jest } from '@jest/globals';

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

// helper: create deterministic mocks for crypto, tweetnacl, tweetnacl-util
async function loadCryptoProvisionModule() {
  jest.resetModules();

  //
  // Mock crypto
  //
  const randomBytesMock = jest.fn((len) => Buffer.from('R'.repeat(len)));
  const hkdfSyncMock = jest.fn(
    (hashAlg, salt, ikm, info, len) => {
      // We'll just return Buffer.from('KDF:' + hex(ikm)+':'+hex(info)).slice(0,len)
      const hexIkm = Buffer.from(ikm).toString('hex');
      const hexInfo = Buffer.from(info).toString('hex');
      const raw = Buffer.from(`KDF:${hashAlg}:${hexIkm}:${hexInfo}`);
      return raw.slice(0, len);
    }
  );

  jest.unstable_mockModule('crypto', () => ({
    default: { randomBytes: randomBytesMock, hkdfSync: hkdfSyncMock },
    randomBytes: randomBytesMock,
    hkdfSync: hkdfSyncMock,
  }));

  //
  // Mock tweetnacl + tweetnacl-util
  //
  // scalarMult(ePriv, otherPub) -> return Uint8Array([...ePriv, ...otherPub])
  const scalarMultMock = jest.fn((ePrivU8, otherPubU8) => {
    const buf = Buffer.concat([
      Buffer.from(ePrivU8),
      Buffer.from(otherPubU8),
    ]);
    return new Uint8Array(buf);
  });

  // secretbox(msg, nonce, k) -> Uint8Array("BOX|" + msgUTF8 + "|" + nonceUTF8 + "|" + kUTF8)
  const secretboxMock = jest.fn((msgU8, nonceU8, keyU8) => {
    const outBuf = Buffer.from(
      'BOX|' +
        Buffer.from(msgU8).toString('utf8') +
        '|' +
        Buffer.from(nonceU8).toString('utf8') +
        '|' +
        Buffer.from(keyU8).toString('utf8')
    );
    return new Uint8Array(outBuf);
  });

  // secretbox.open(ct, nonce, k):
  // verifies nonce/key match and returns original msg, otherwise null
  const secretboxOpenMock = jest.fn((ctU8, nonceU8, keyU8) => {
    // our sealed format: "BOX|<msg>|<nonce>|<key>"
    const parts = Buffer.from(ctU8).toString('utf8').split('|');
    // ["BOX", "<msg>", "<nonce>", "<key>"]
    if (parts[0] !== 'BOX') return null;

    const [_, msg, nonceStr, keyStr] = parts;
    if (
      nonceStr !== Buffer.from(nonceU8).toString('utf8') ||
      keyStr !== Buffer.from(keyU8).toString('utf8')
    ) {
        return null;
    }
    return new Uint8Array(Buffer.from(msg, 'utf8'));
  });

  const naclMock = {
    scalarMult: scalarMultMock,
    secretbox: secretboxMock,
    randomBytes: jest.fn((len) => Buffer.from('N'.repeat(len))), // deterministic nonce
    secretbox_open_ref: secretboxOpenMock, // just keeping reference
  };
  // real API style: nacl.secretbox.open
  naclMock.secretbox.open = secretboxOpenMock;

  jest.unstable_mockModule('tweetnacl', () => ({
    default: naclMock,
    ...naclMock,
  }));

  // tweetnacl-util
  const decodeUTF8Mock = jest.fn((str) =>
    new Uint8Array(Buffer.from(str, 'utf8'))
  );
  const encodeUTF8Mock = jest.fn((u8) =>
    Buffer.from(u8).toString('utf8')
  );

  jest.unstable_mockModule('tweetnacl-util', () => ({
    default: {
      decodeUTF8: decodeUTF8Mock,
      encodeUTF8: encodeUTF8Mock,
    },
    decodeUTF8: decodeUTF8Mock,
    encodeUTF8: encodeUTF8Mock,
  }));

  // Now import the module under test
  const mod = await import('../../utils/cryptoProvision.js');

  return {
    mod,
    mocks: {
      randomBytesMock,
      hkdfSyncMock,
      scalarMultMock,
      secretboxMock,
      secretboxOpenMock,
      decodeUTF8Mock,
      encodeUTF8Mock,
    },
  };
}

describe('randomBytes', () => {
  test('returns crypto.randomBytes(n)', async () => {
    const { mod, mocks } = await loadCryptoProvisionModule();
    const { randomBytes } = mod;

    const buf = randomBytes(16);
    expect(buf).toEqual(Buffer.from('R'.repeat(16)));
    expect(mocks.randomBytesMock).toHaveBeenCalledWith(16);
  });
});

describe('toB64 / fromB64', () => {
  test('base64 encodes and decodes buffers', async () => {
    const { mod } = await loadCryptoProvisionModule();
    const { toB64, fromB64 } = mod;

    const src = Buffer.from('hello!');
    const b64 = toB64(src);
    expect(b64).toBe(src.toString('base64'));

    const round = fromB64(b64);
    expect(round.equals(src)).toBe(true);
  });
});

describe('hkdf', () => {
  test('calls crypto.hkdfSync with sha256, empty salt, given keyMaterial, info="provision-v1", len=32 by default', async () => {
    const { mod, mocks } = await loadCryptoProvisionModule();
    const { hkdf } = mod;

    const out = hkdf('SEEDMATERIAL'); // default info/len

    // ensure hkdfSync called correctly
    expect(mocks.hkdfSyncMock).toHaveBeenCalledTimes(1);
    const [alg, salt, ikm, info, length] = mocks.hkdfSyncMock.mock.calls[0];
    expect(alg).toBe('sha256');
    expect(salt).toEqual(Buffer.alloc(0));
    expect(ikm).toEqual(Buffer.from('SEEDMATERIAL'));
    expect(info).toEqual(Buffer.from('provision-v1'));
    expect(length).toBe(32);

    // output should be what our mock hkdfSync returns
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(32);
  });

  test('respects custom info and len overrides', async () => {
    const { mod, mocks } = await loadCryptoProvisionModule();
    const { hkdf } = mod;

    const out = hkdf('ABC', 'custom-info', 16);

    const [alg, salt, ikm, info, length] = mocks.hkdfSyncMock.mock.calls[1];
    expect(info).toEqual(Buffer.from('custom-info'));
    expect(length).toBe(16);

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(16);
  });
});

describe('deriveSharedKey', () => {
  test('scalarMult(ePriv, otherPub), concat shared||secret, hkdf(...,"provision-v1",32)', async () => {
    const { mod, mocks } = await loadCryptoProvisionModule();
    const { deriveSharedKey } = mod;

    // base64 strings for inputs
    const ePrivBuf = Buffer.from('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'); // 32 bytes 'E'
    const otherPubBuf = Buffer.from('PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP'); // 32 bytes 'P'
    const secretBuf = Buffer.from('SSSSSSSS'); // extra shared secret material

    const ePriv_b64 = ePrivBuf.toString('base64');
    const otherPub_b64 = otherPubBuf.toString('base64');
    const secret_b64 = secretBuf.toString('base64');

    const outKey = deriveSharedKey(ePriv_b64, otherPub_b64, secret_b64);

    // nacl.scalarMult should have been called once with Uint8Arrays of decoded keys
    expect(mocks.scalarMultMock).toHaveBeenCalledTimes(1);
    const [argPriv, argPub] = mocks.scalarMultMock.mock.calls[0];
    expect(Buffer.from(argPriv).equals(ePrivBuf)).toBe(true);
    expect(Buffer.from(argPub).equals(otherPubBuf)).toBe(true);

    // hkdfSync should have been called with Buffer.concat([shared, secret])
    // Our scalarMult mock returns Uint8Array([...priv, ...pub])
    const sharedExpected = Buffer.concat([ePrivBuf, otherPubBuf]);
    const combinedExpected = Buffer.concat([sharedExpected, secretBuf]);

    const lastHKDFArgs = mocks.hkdfSyncMock.mock.calls[mocks.hkdfSyncMock.mock.calls.length - 1];
    const [_alg, _salt, ikm, info, length] = lastHKDFArgs;

    expect(info).toEqual(Buffer.from('provision-v1'));
    expect(length).toBe(32);
    expect(Buffer.from(ikm).equals(combinedExpected)).toBe(true);

    expect(Buffer.isBuffer(outKey)).toBe(true);
  });
});

describe('seal', () => {
  test('creates nonce with nacl.randomBytes(24), encodes JSON via decodeUTF8, secretbox() it, and returns base64 strings', async () => {
    const { mod, mocks } = await loadCryptoProvisionModule();
    const { seal } = mod;

    const key = Buffer.from('KKKKKKKKKKKKKKKK'); // symmetric secretbox key
    const payload = { hello: 'world', n: 123 };

    const sealed = seal(key, payload);

    // nonce should come from our nacl.randomBytes mock -> "N" repeated
    const expectedNonceB64 = Buffer.from('N'.repeat(24)).toString('base64');
    expect(sealed.nonce).toBe(expectedNonceB64);

    // secretbox should have been called once
    expect(mocks.secretboxMock).toHaveBeenCalledTimes(1);

    // decodeUTF8 should have been called with JSON string of payload
    expect(mocks.decodeUTF8Mock).toHaveBeenCalledTimes(1);
    const jsonArg = mocks.decodeUTF8Mock.mock.calls[0][0];
    expect(jsonArg).toBe(JSON.stringify(payload));

    // ciphertext is base64 of our mock secretbox output
    const builtCT = mocks.secretboxMock.mock.results[0].value; // Uint8Array
    const builtCTBuf = Buffer.from(builtCT);
    const expectedCtB64 = builtCTBuf.toString('base64');

    expect(sealed.ciphertext).toBe(expectedCtB64);
  });
});

describe('open', () => {
  test('base64-decodes nonce + ciphertext, calls secretbox.open, decode UTF8 + parse JSON on success', async () => {
    const { mod, mocks } = await loadCryptoProvisionModule();
    const { open } = mod;

    const key = Buffer.from('KKKKKKKKKKKKKKKK');

    const nonceBuf = Buffer.from('N'.repeat(24));
    const msgJSON = JSON.stringify({ a: 1, b: 'two' });
    const ctBuf = Buffer.from(
      'BOX|' +
        msgJSON +
        '|' +
        nonceBuf.toString('utf8') +
        '|' +
        key.toString('utf8')
    );

    const nonce_b64 = nonceBuf.toString('base64');
    const ct_b64 = ctBuf.toString('base64');

    const obj = open(key, nonce_b64, ct_b64);
    expect(obj).toEqual({ a: 1, b: 'two' });

    expect(mocks.secretboxOpenMock).toHaveBeenCalledTimes(1);
    expect(mocks.encodeUTF8Mock).toHaveBeenCalledTimes(1);
  });

  test('throws if secretbox.open returns null (auth fail / tamper)', async () => {
    const { mod, mocks } = await loadCryptoProvisionModule();
    const { open } = mod;

    // Force failure
    mocks.secretboxOpenMock.mockReturnValueOnce(null);

    const badNonce = Buffer.from('BADNONCE').toString('base64');
    const badCt = Buffer.from('BADCIPHER').toString('base64');

    expect(() => open(Buffer.from('key'), badNonce, badCt)).toThrow(
      'Decryption failed'
    );
  });
});
