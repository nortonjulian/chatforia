/** @jest-environment node */
import { describe, test, expect } from '@jest/globals';
import { parseSingleByteRange } from '../utils/httpByteRanges.js';

describe('private media byte-range contract', () => {
  test('supports explicit, open-ended and suffix ranges', () => {
    expect(parseSingleByteRange('bytes=0-4', 10)).toEqual({start:0,end:4});
    expect(parseSingleByteRange('bytes=4-', 10)).toEqual({start:4,end:9});
    expect(parseSingleByteRange('bytes=-3', 10)).toEqual({start:7,end:9});
    expect(parseSingleByteRange('bytes=5-100', 10)).toEqual({start:5,end:9});
  });
  test('rejects invalid ranges and multipart ranges', () => {
    for (const value of ['bytes=10-', 'bytes=5-4', 'bytes=0-1,5-6', 'items=0-2', 'bytes=-0', 'bytes=--1', 'bytes=1.5-2']) {
      expect(parseSingleByteRange(value, 10)).toBeNull();
    }
    expect(parseSingleByteRange('bytes=0-1', 0)).toBeNull();
  });
});
