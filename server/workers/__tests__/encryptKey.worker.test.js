const ORIGINAL_ENV = process.env;

let postMessageMock;

// Build deterministic mocks for the worker's dependencies
function mockWorkerThreads(workerData) {
  postMessageMock = jest.fn();
  jest.doMock('node:worker_threads', () => ({
    __esModule: true,
    parentPort: { postMessage: postMessageMock },
    workerData,
  }));
}

function mockB64() {
  // Encode returns a readable marker of the bytes.
  const encode = (u8) => `ENC(${Array.from(u8).join(',')})`;
  // Decode returns fixed byte arrays for test symbols
  const decode = (s) => {
    if (s === 'MSG') return new Uint8Array([77]);  // arbitrary 1-byte msg key for test
    if (s === 'PUB') return new Uint8Array([88]);  // arbitrary 1-byte pubkey for test
    return new Uint8Array([]);
  };
  jest.doMock('../../utils/b64.js', () => ({
    __esModule: true,
    decode: decode,
    encode: encode,
  }));
}

function mockTweetNaCl({ shouldThrow = false } = {}) {
  const boxImpl = shouldThrow
    ? () => { throw new Error('box_fail'); }
    : () => new Uint8Array([7, 7, 7]); // deterministic ciphertext payload

  // tweetnacl.box is a function with a .keyPair()
  const keyPair = () => ({
    publicKey: new Uint8Array([1, 2, 3, 4]), // deterministic eph pub
    secretKey: new Uint8Array([42]),        // value unused by test
  });

  const boxFn = (...args) => boxImpl(...args);
  boxFn.keyPair = keyPair;

  const randomBytes = (n) => new Uint8Array(new Array(n).fill(9)); // deterministic nonce

  jest.doMock('tweetnacl', () => ({
    __esModule: true,
    default: { box: boxFn, randomBytes },
  }));
}

const reload = async () => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  return import('../encryptKey.worker.js'); // side-effect executes worker code
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('encryptKey.worker', () => {
  test('success: posts sealed payload with deterministic concat', async () => {
    mockWorkerThreads({ msgKeyB64: 'MSG', recipientPubB64: 'PUB' });
    mockB64();
    mockTweetNaCl({ shouldThrow: false });

    await reload(); // importing runs the worker once

    // Expect a single postMessage with ok:true
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const msg = postMessageMock.mock.calls[0][0];

    // Build expected sealed bytes: ephPub(4) + nonce(24 of 9) + boxed(3 of 7)
    const expected = [
      1, 2, 3, 4,                           // eph public key
      ...new Array(24).fill(9),             // nonce
      7, 7, 7,                               // ciphertext (mocked)
    ];
    expect(msg).toEqual({
      ok: true,
      recipientPubB64: 'PUB',
      sealedKeyB64: `ENC(${expected.join(',')})`,
    });
  });

  test('failure: if nacl.box throws, posts ok:false with error', async () => {
    mockWorkerThreads({ msgKeyB64: 'MSG', recipientPubB64: 'PUB' });
    mockB64();
    mockTweetNaCl({ shouldThrow: true });

    await reload();

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const msg = postMessageMock.mock.calls[0][0];
    expect(msg.ok).toBe(false);
    expect(String(msg.err)).toMatch(/box_fail/);
  });
});
