// server/workers/__tests__/encryptKey.worker.test.js
import { jest } from '@jest/globals';
import { encode as b64encode } from '../../utils/b64.js'; // use real Base64 encode

const ORIGINAL_ENV = process.env;

let postMessageMock;

/**
 * Set up mocks for this run and import the worker once.
 * The import executes the worker's top-level code (which will call parentPort.postMessage).
 */
async function runWorkerOnce({ workerData, shouldThrow }) {
  // Clear module cache so our mocks can apply fresh
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

  // New mock for each run
  postMessageMock = jest.fn();

  // --- Mock node:worker_threads using unstable_mockModule (ESM-safe) ---
  await jest.unstable_mockModule('node:worker_threads', () => ({
    __esModule: true,
    parentPort: { postMessage: postMessageMock },
    workerData,
  }));

  // --- Mock tweetnacl deterministically ---
  await jest.unstable_mockModule('tweetnacl', () => {
    const boxImpl = shouldThrow
      ? () => {
          throw new Error('box_fail');
        }
      : () => new Uint8Array([7, 7, 7]); // deterministic ciphertext payload

    const keyPair = () => ({
      publicKey: new Uint8Array([1, 2, 3, 4]), // deterministic eph pub
      secretKey: new Uint8Array([42]), // unused in our tests
    });

    const boxFn = (...args) => boxImpl(...args);
    boxFn.keyPair = keyPair;

    const randomBytes = (n) => new Uint8Array(new Array(n).fill(9)); // deterministic nonce

    return {
      __esModule: true,
      default: { box: boxFn, randomBytes },
    };
  });

  // Now import the worker – this will use the mocked modules above.
  await import('../encryptKey.worker.js');

  return postMessageMock;
}

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('encryptKey.worker', () => {
  test('success: posts sealed payload with deterministic concat', async () => {
    const postMessage = await runWorkerOnce({
      workerData: { msgKeyB64: 'MSG', recipientPubB64: 'PUB' },
      shouldThrow: false,
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const msg = postMessage.mock.calls[0][0];

    // Build expected sealed bytes: ephPub(4) + nonce(24 of 9) + boxed(3 of 7)
    const expected = [
      1, 2, 3, 4, // eph public key
      ...new Array(24).fill(9), // nonce
      7, 7, 7, // ciphertext (mocked)
    ];

    const expectedU8 = new Uint8Array(expected);

    expect(msg).toEqual({
      ok: true,
      recipientPubB64: 'PUB',
      sealedKeyB64: b64encode(expectedU8), // real base64 of those bytes
    });
  });

  test('failure: if nacl.box throws, posts ok:false with error', async () => {
    const postMessage = await runWorkerOnce({
      workerData: { msgKeyB64: 'MSG', recipientPubB64: 'PUB' },
      shouldThrow: true,
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const msg = postMessage.mock.calls[0][0];

    expect(msg.ok).toBe(false);
    expect(String(msg.err)).toMatch(/box_fail/);
  });
});
