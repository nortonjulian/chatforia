import { jest } from '@jest/globals';

const ORIGINAL_NOW = Date.now;

afterEach(() => {
  // restore globals
  Date.now = ORIGINAL_NOW;
  jest.resetModules();
  jest.restoreAllMocks();
});

// helper to load module with a crypto mock
async function loadBotSignModule({
  hmacDigestHex = 'deadbeef',
  timingSafeEqualImpl,
} = {}) {
  jest.resetModules();

  // mock HMAC instance returned by crypto.createHmac(...)
  const updateMock = jest.fn(function (data) {
    // allow chaining
    this._updatedWith = data;
    return this;
  });
  const digestMock = jest.fn(() => hmacDigestHex);

  const hmacObj = {
    update: updateMock,
    digest: digestMock,
    _updatedWith: null,
  };

  const createHmacMock = jest.fn((alg, secret) => {
    // stash alg/secret for assertions
    hmacObj._alg = alg;
    hmacObj._secret = secret;
    return hmacObj;
  });

  // default timingSafeEqual: strict buffer equality
  const timingSafeEqualMock =
    timingSafeEqualImpl ||
    jest.fn((a, b) => {
      if (a.length !== b.length) return false;
      return a.toString('hex') === b.toString('hex');
    });

  jest.unstable_mockModule('crypto', () => ({
    default: {
      createHmac: createHmacMock,
      timingSafeEqual: timingSafeEqualMock,
    },
    createHmac: createHmacMock,
    timingSafeEqual: timingSafeEqualMock,
  }));

  const mod = await import('../../utils/botSign.js');

  return {
    mod,
    mocks: {
      createHmacMock,
      updateMock,
      digestMock,
      timingSafeEqualMock,
      hmacObj,
    },
  };
}

describe('signBody', () => {
  test('produces sha256=<hex> from HMAC(secret, `${ts}.${body}`)', async () => {
    const { mod, mocks } = await loadBotSignModule({
      hmacDigestHex: 'cafebabe1234',
    });
    const { signBody } = mod;

    const ts = '1730000000000'; // pretend ms timestamp string
    const body = '{"event":"ping"}';
    const secret = 'supersecret';

    const sig = signBody(secret, ts, body);

    // Should prefix with sha256=
    expect(sig).toBe('sha256=cafebabe1234');

    // Ensure we called crypto.createHmac('sha256', secret)
    expect(mocks.createHmacMock).toHaveBeenCalledWith('sha256', secret);

    // Ensure update() got the correct string `${ts}.${body}`
    expect(mocks.updateMock).toHaveBeenCalledWith(`${ts}.${body}`);

    // Ensure digest('hex') was called
    expect(mocks.digestMock).toHaveBeenCalledWith('hex');
  });
});

describe('verifySignature', () => {
  test('returns true when timestamp is recent and headerSig matches expected HMAC (constant time)', async () => {
    // Fix "now" to a known timestamp (ms)
    Date.now = () => 2_000_000_000_000; // e.g. ~2033-05-18

    // Use a deterministic HMAC digest
    const { mod, mocks } = await loadBotSignModule({
      hmacDigestHex: 'deadbeef',
    });
    const { verifySignature } = mod;

    const secret = 'abc123';
    const ts = String(2_000_000_000_000); // same as Date.now()
    const body = '{"hello":"world"}';
    const headerSig = 'sha256=deadbeef';

    const ok = verifySignature(secret, ts, body, headerSig, 300);
    expect(ok).toBe(true);

    // Check createHmac got called as expected under the hood
    expect(mocks.createHmacMock).toHaveBeenCalledWith('sha256', secret);

    // Check timingSafeEqual got buffers of equal length and equal value
    expect(mocks.timingSafeEqualMock).toHaveBeenCalledTimes(1);
    const [bufA, bufB] = mocks.timingSafeEqualMock.mock.calls[0];
    expect(bufA.equals(Buffer.from('sha256=deadbeef'))).toBe(true);
    expect(bufB.equals(Buffer.from('sha256=deadbeef'))).toBe(true);
  });

  test('returns false if ts is not a finite number', async () => {
    Date.now = () => 1000;

    const { mod } = await loadBotSignModule();
    const { verifySignature } = mod;

    const badTs = 'not-a-number';
    const res = verifySignature('s', badTs, '{}', 'sha256=deadbeef');
    expect(res).toBe(false);
  });

  test('returns false if timestamp is outside tolerance window', async () => {
    // now = 10_000
    Date.now = () => 10_000;

    const { mod } = await loadBotSignModule();
    const { verifySignature } = mod;

    // ts way older than tolerance=5s (5000ms)
    const oldTs = String(10_000 - 10_000); // 0ms
    const tooOld = verifySignature('s', oldTs, '{}', 'sha256=deadbeef', 5);
    expect(tooOld).toBe(false);

    // ts way in the future
    const futureTs = String(10_000 + 10_000); // 20_000ms
    const tooFuture = verifySignature('s', futureTs, '{}', 'sha256=deadbeef', 5);
    expect(tooFuture).toBe(false);
  });

  test('returns false if lengths differ (fast reject before timingSafeEqual)', async () => {
    Date.now = () => 12345;

    const { mod } = await loadBotSignModule({
      hmacDigestHex: 'deadbeef',
    });
    const { verifySignature } = mod;

    const ts = String(12345);
    const badHeader = 'sha256=WRONG-LENGTH'; // different length than expected ('sha256=deadbeef')

    const res = verifySignature('s', ts, '{}', badHeader, 300);
    expect(res).toBe(false);
  });

  test('returns false if timingSafeEqual says no (mismatch but same length)', async () => {
    Date.now = () => 5000;

    // Force timingSafeEqual to always return false
    const { mod } = await loadBotSignModule({
      hmacDigestHex: 'deadbeef',
      timingSafeEqualImpl: jest.fn(() => false),
    });
    const { verifySignature } = mod;

    const ts = String(5000);
    const headerSig = 'sha256=deadbeef'; // same length, but timingSafeEqual -> false

    const res = verifySignature('sec', ts, '{"a":1}', headerSig, 300);
    expect(res).toBe(false);
  });

  test('returns false if headerSig is missing/undefined', async () => {
    Date.now = () => 7777;

    const { mod } = await loadBotSignModule({
      hmacDigestHex: 'deadbeef',
    });
    const { verifySignature } = mod;

    const ts = String(7777);

    const res = verifySignature('sec', ts, '{}', undefined, 300);
    expect(res).toBe(false);
  });
});
