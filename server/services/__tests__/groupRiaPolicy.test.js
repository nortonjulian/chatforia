import { describe, expect, test } from '@jest/globals';
import {
  extractGroupRiaPrompt,
  hasEncryptedMessageIndicators,
} from '../groupRiaPolicy.js';

describe('group Ria explicit invocation policy', () => {
  test.each([
    ['@Ria explain this', 'explain this'],
    ['hello @Ria, explain this', 'hello, explain this'],
    ['@ForiaBot explain this', 'explain this'],
    ['/ask explain this', 'explain this'],
    ['/ASK explain this', 'explain this'],
    ['@ria: help?', 'help?'],
  ])('parses %s', (input, expected) => {
    expect(extractGroupRiaPrompt(input)).toBe(expected);
  });

  test.each([
    'hello everyone',
    'ria can help',
    '@Ria',
    '/ask',
    'test@example.com',
    'hello@ria',
    '/asking',
    '',
    null,
  ])('does not invoke from %s', (input) => {
    expect(extractGroupRiaPrompt(input)).toBeNull();
  });

  test('denies encrypted content and missing message data', () => {
    expect(hasEncryptedMessageIndicators(null)).toBe(true);
    expect(hasEncryptedMessageIndicators({ contentCiphertext: 'cipher' })).toBe(true);
    expect(hasEncryptedMessageIndicators({ encryptedPayloads: { 1: { ciphertext: 'x' } } })).toBe(true);
    expect(hasEncryptedMessageIndicators({ keys: [{ userId: 1 }] })).toBe(true);
    expect(hasEncryptedMessageIndicators({ payloads: [{ userId: 1 }] })).toBe(true);
    expect(hasEncryptedMessageIndicators({ sessionKeys: [{ messageId: 5 }] })).toBe(true);
    expect(hasEncryptedMessageIndicators({ rawContent: '@Ria hello' })).toBe(false);
  });
});
