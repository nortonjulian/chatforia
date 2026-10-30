import { messageCacheKey, assertMessageCacheKey } from '../messageCacheKey.js';

test('separates accounts sharing a room ID', () => {
  expect(messageCacheKey(65, 85)).toBe('65:85');
  expect(messageCacheKey(1, 85)).toBe('1:85');
  expect(messageCacheKey(65, 90)).toBe('65:90');
});

test('rejects missing account or room identity', () => {
  expect(() => messageCacheKey(null, 85)).toThrow();
  expect(() => messageCacheKey(undefined, 85)).toThrow();
  expect(() => messageCacheKey(65, null)).toThrow();
  expect(() => messageCacheKey(0, 85)).toThrow();
  expect(() => messageCacheKey(65, 'invalid')).toThrow();
});

test('accepts safe numeric string identifiers', () => {
  expect(messageCacheKey('65', '85')).toBe('65:85');
});


test('storage validation rejects unscoped keys', () => {
  expect(() => assertMessageCacheKey('83')).toThrow();
  expect(() => assertMessageCacheKey(null)).toThrow();
  expect(() => assertMessageCacheKey('0:83')).toThrow();
  expect(() => assertMessageCacheKey('65:0')).toThrow();
  expect(() => assertMessageCacheKey('65:invalid')).toThrow();
});

test('storage validation accepts account-scoped keys', () => {
  expect(assertMessageCacheKey('65:83')).toBe('65:83');
  expect(assertMessageCacheKey('1:83')).toBe('1:83');
});
