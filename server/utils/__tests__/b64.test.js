import {
  describe,
  test,
  expect,
} from '@jest/globals';

const { encode, decode, strToU8, u8ToStr } = await import('../../utils/b64.js');

describe('b64 utils', () => {
  test('encode returns empty string for null/undefined/empty input', () => {
    expect(encode(null)).toBe('');
    expect(encode(undefined)).toBe('');
    expect(encode(new Uint8Array())).toBe('');
  });

  test('encode produces correct base64 for known data', () => {
    const u8 = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const b64 = encode(u8);
    expect(b64).toBe('SGVsbG8=');
  });

  test('decode returns empty Uint8Array for falsy input', () => {
    const decodedNull = decode(null);
    const decodedEmpty = decode('');

    expect(decodedNull).toBeInstanceOf(Uint8Array);
    expect(decodedNull.length).toBe(0);

    expect(decodedEmpty).toBeInstanceOf(Uint8Array);
    expect(decodedEmpty.length).toBe(0);
  });

  test('decode converts base64 back to Uint8Array', () => {
    const b64 = 'SGVsbG8='; // "Hello"
    const u8 = decode(b64);

    expect(u8).toBeInstanceOf(Uint8Array);
    expect(Array.from(u8)).toEqual([72, 101, 108, 108, 111]);
  });

  test('encode/decode round-trip for arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const b64 = encode(original);
    const decoded = decode(b64);

    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  test('strToU8 and u8ToStr round-trip ASCII', () => {
    const s = 'Chatforia-123';
    const u8 = strToU8(s);
    const s2 = u8ToStr(u8);

    expect(u8).toBeInstanceOf(Uint8Array);
    expect(s2).toBe(s);
  });

  test('strToU8 and u8ToStr round-trip non-ASCII characters', () => {
    const s = 'こんにちは Chatforia 🌍';
    const u8 = strToU8(s);
    const s2 = u8ToStr(u8);

    expect(u8).toBeInstanceOf(Uint8Array);
    expect(s2).toBe(s);
  });

  test('encode/str helpers combined round-trip', () => {
    const s = 'b64+utf8 combo ✅';
    const u8 = strToU8(s);
    const b64 = encode(u8);
    const decodedU8 = decode(b64);
    const s2 = u8ToStr(decodedU8);

    expect(s2).toBe(s);
  });
});
