/** @jest-environment node */
import { describe, test, expect } from '@jest/globals';
import { logSafeRequestPath } from '../utils/logSafeRequestPath.js';

describe('media capability token logging', () => {
  test('strips signed bearer tokens and query strings from logged paths', () => {
    expect(logSafeRequestPath('/private-media/file?token=SUPER_SECRET_VALUE')).toBe('/private-media/file');
    expect(logSafeRequestPath('/private-media/message/42?variant=file')).toBe('/private-media/message/42');
    expect(logSafeRequestPath('/files?token=OLD_SECRET#fragment')).toBe('/files');
    expect(logSafeRequestPath('/sms/media/12/0')).toBe('/sms/media/12/0');
  });
  test('empty or non-string values never expose tokens', () => {
    expect(logSafeRequestPath(null)).toBe('/');
    expect(logSafeRequestPath('')).toBe('/');
    expect(logSafeRequestPath(123)).toBe('/');
  });
});
