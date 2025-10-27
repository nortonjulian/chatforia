import { jest } from '@jest/globals';
import { LRU } from '../../utils/lru.js';

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('LRU cache', () => {
  test('get() returns undefined for missing keys and returns stored value for existing keys', () => {
    const cache = new LRU(10);

    expect(cache.get('nope')).toBeUndefined();

    cache.set('a', 123, 10_000);
    expect(cache.get('a')).toBe(123);
  });

  test('get() moves the key to most-recent position', () => {
    const cache = new LRU(3);

    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    // insertion order: a, b, c

    // Access 'a' to mark it as most recently used
    expect(cache.get('a')).toBe('A');
    // order should now be: b, c, a

    // Add 'd' -> triggers eviction (size 4 > max 3)
    cache.set('d', 'D');

    // Least-recently-used should have been 'b'
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  test('has() returns true for fresh entries and false for expired or missing', () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-01-01T00:00:00.000Z'));

    const cache = new LRU(5);

    // set with ttlMs = 5 seconds
    cache.set('x', 'valX', 5_000);

    // fresh
    expect(cache.has('x')).toBe(true);

    // advance past expiry
    jest.setSystemTime(new Date('2035-01-01T00:00:06.000Z'));
    expect(cache.has('x')).toBe(false); // should also delete it

    // further calls after expiry should keep returning false
    expect(cache.has('x')).toBe(false);

    // unrelated/missing key is just false
    expect(cache.has('nope')).toBe(false);
  });

  test('expired entries are purged by has(), and then get() will return undefined', () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-05-10T12:00:00.000Z'));

    const cache = new LRU(5);
    cache.set('session', { userId: 123 }, 1_000); // 1s ttl

    // still valid
    expect(cache.has('session')).toBe(true);
    expect(cache.get('session')).toEqual({ userId: 123 });

    // advance time past ttl
    jest.setSystemTime(new Date('2035-05-10T12:00:02.000Z'));

    // has() should evict because expired
    expect(cache.has('session')).toBe(false);

    // Now get() should behave like it's not there
    expect(cache.get('session')).toBeUndefined();
  });

  test('_evict() removes least recently used entries when size exceeds max', () => {
    const cache = new LRU(2);

    // Insert two keys
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    // Order: k1, k2

    // Access k1, making it most-recent
    expect(cache.get('k1')).toBe('v1');
    // Order now: k2, k1

    // Add k3 -> should evict least-recent (k2)
    cache.set('k3', 'v3');
    // Now cache should contain k1, k3
    expect(cache.has('k2')).toBe(false);
    expect(cache.has('k1')).toBe(true);
    expect(cache.has('k3')).toBe(true);

    // Add k4 -> should evict least-recent again
    // Current order is k1, k3
    cache.set('k4', 'v4');
    expect(cache.has('k1')).toBe(false);
    expect(cache.has('k3')).toBe(true);
    expect(cache.has('k4')).toBe(true);
  });

  test('set() stores { value, expiresAt } with ttlMs defaulting to 5 minutes', () => {
    jest.useFakeTimers().setSystemTime(new Date('2040-09-09T09:00:00.000Z'));

    const cache = new LRU(10);
    cache.set('foo', 'bar'); // default ttlMs = 300000ms (5 minutes)

    // This reaches into the Map directly. That's fine in tests.
    const entry = cache.map.get('foo');
    expect(entry.value).toBe('bar');

    const expectedExpiryMs = new Date('2040-09-09T09:05:00.000Z').getTime();
    expect(entry.expiresAt).toBe(expectedExpiryMs);
  });
});
