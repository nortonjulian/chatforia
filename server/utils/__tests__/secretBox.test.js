import { jest } from '@jest/globals';
import crypto from 'node:crypto';

const ORIGINAL_ENV = { ...process.env };

// helper to base64-encode a 32-byte key we control
function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

// helper to load the module fresh with a specific APP_ENC_KEY and optional crypto.randomBytes mock
async function loadSecretBox({ keyBytes, mockRandomBytes } = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

  if (keyBytes) {
    process.env.APP_ENC_KEY = b64(keyBytes); // must be 32 bytes
  } else {
    delete process.env.APP_ENC_KEY;
  }

  // optionally mock crypto.randomBytes before import
  if (mockRandomBytes) {
    jest.spyOn(crypto, 'randomBytes').mockImplementation(mockRandomBytes);
  }

  const mod = await import('../../utils/secretBox.js');
  return mod;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('secretBox', () => {
  test('seal() then open() round-trips plaintext using AES-256-GCM', async () => {
    // 32-byte key
    const keyBytes = crypto.randomBytes(32);

    const { seal, open } = await loadSecretBox({ keyBytes });

    const plaintext = 'hello 🌍 super secret';
    const sealed = seal(plaintext);

    expect(typeof sealed).toBe('string');
    // base64 should decode to a Buffer of length >= 12 + 16
    const raw = Buffer.from(sealed, 'base64');
    expect(raw.length).toBeGreaterThanOrEqual(28);

    const opened = open(sealed);
    expect(opened).toBe(plaintext);
  });

  test('multiple calls to seal() with same plaintext produce different ciphertexts (random IV)', async () => {
    const keyBytes = crypto.randomBytes(32);
    const { seal } = await loadSecretBox({ keyBytes });

    const p = 'idempotence? never heard of her';
    const a = seal(p);
    const b = seal(p);

    // They should not be identical because IV should differ.
    expect(a).not.toBe(b);
  });

  test('open() throws if ciphertext/tag is tampered', async () => {
    const keyBytes = crypto.randomBytes(32);
    const { seal, open } = await loadSecretBox({ keyBytes });

    const sealed = seal('attack at dawn');
    const buf = Buffer.from(sealed, 'base64');

    // flip one byte in ciphertext
    const tampered = Buffer.from(buf);
    // modify last byte
    tampered[tampered.length - 1] =
      (tampered[tampered.length - 1] ^ 0xff) & 0xff;

    const tamperedB64 = tampered.toString('base64');

    expect(() => open(tamperedB64)).toThrow();
  });

  test('output format is [iv(12) | tag(16) | ciphertext] base64', async () => {
    // deterministic IV so we can assert layout.
    // We'll generate a fixed 32-byte key.
    const keyBytes = Buffer.alloc(32, 7); // 32 bytes of 0x07

    // Mock randomBytes(12) to always return predictable IV bytes.
    const fixedIv = Buffer.from('iv_iv_iv_iv!!', 'utf8').subarray(0, 12); // ensure length 12

    const mockRandomBytes = (len) => {
      if (len === 12) return fixedIv;
      // shouldn't be called with other lengths in seal()
      return crypto.randomBytes(len);
    };

    const { seal } = await loadSecretBox({
      keyBytes,
      mockRandomBytes,
    });

    const sealed = seal('thumbnail preview');
    const buf = Buffer.from(sealed, 'base64');

    // Slice it back out according to spec
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);

    // IV should match our fixed iv
    expect(iv.equals(fixedIv)).toBe(true);

    // Auth tag should be 16 bytes
    expect(tag.length).toBe(16);

    // Ciphertext should be non-empty
    expect(ct.length).toBeGreaterThan(0);
  });

  test('warns if APP_ENC_KEY is not 32 bytes', async () => {
    // keyBytes length != 32 should trigger console.warn at module load
    const shortKey = Buffer.alloc(16, 1); // 16 bytes

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    await loadSecretBox({ keyBytes: shortKey });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0];
    expect(String(msg)).toMatch(
      /\[secretBox\] APP_ENC_KEY must be 32 bytes base64/
    );
  });

  test('does not warn when APP_ENC_KEY is exactly 32 bytes', async () => {
    const goodKey = Buffer.alloc(32, 2);

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    await loadSecretBox({ keyBytes: goodKey });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
