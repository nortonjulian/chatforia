import { jest } from '@jest/globals';

import { allow, __resetForTests } from '../../utils/tokenBucket.js';

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  __resetForTests(); // make sure buckets is empty for the next test
});

describe('tokenBucket.allow()', () => {
  test('first call for a user succeeds and consumes a token', () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-01-01T00:00:00Z'));

    const ok1 = allow('userA');
    expect(ok1).toBe(true);

    const ok2 = allow('userA');
    expect(ok2).toBe(true);
  });

  test('after rate tokens in a burst, further calls return false until refill', () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-01-01T00:00:00Z'));

    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(allow('userA'));
    }
    expect(results).toEqual([true, true, true, true, true, true, true, true]);

    const ninth = allow('userA');
    expect(ninth).toBe(false);

    jest.advanceTimersByTime(5000); // +5s

    const after5s = allow('userA');
    expect(after5s).toBe(true);

    const burst = [
      allow('userA'),
      allow('userA'),
      allow('userA'),
      allow('userA'),
    ];

    expect(burst.includes(false)).toBe(true);
  });

  test('full refill after enough time restores bucket to cap', () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-01-01T00:00:00Z'));

    for (let i = 0; i < 8; i++) allow('userA');
    expect(allow('userA')).toBe(false);

    jest.advanceTimersByTime(10_000); // full window

    const resultsAfterFullWindow = [];
    for (let i = 0; i < 8; i++) {
      resultsAfterFullWindow.push(allow('userA'));
    }
    expect(resultsAfterFullWindow.every(Boolean)).toBe(true);

    expect(allow('userA')).toBe(false);
  });

  test('buckets are isolated per user', () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-01-01T00:00:00Z'));

    for (let i = 0; i < 8; i++) expect(allow('userA')).toBe(true);
    expect(allow('userA')).toBe(false);

    expect(allow('userB')).toBe(true);
    expect(allow('userB')).toBe(true);
  });

  test('custom rate/perMs works (tighter limits)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-01-01T00:00:00Z'));

    const r1 = allow('userC', 2, 1000);
    const r2 = allow('userC', 2, 1000);
    const r3 = allow('userC', 2, 1000);
    expect([r1, r2, r3]).toEqual([true, true, false]);

    jest.advanceTimersByTime(500); // half second

    const r4 = allow('userC', 2, 1000);
    expect(r4).toBe(true);

    const r5 = allow('userC', 2, 1000);
    expect(r5).toBe(false);
  });
});
