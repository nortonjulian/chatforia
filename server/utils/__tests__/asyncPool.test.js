import { asyncPool } from '../asyncPool.js';

describe('asyncPool', () => {
  it('runs tasks with a concurrency limit and returns allSettled results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const limit = 2;

    let active = 0;
    let maxActive = 0;

    const iterator = async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);

      // simulate async work
      await new Promise((resolve) => setTimeout(resolve, 10));

      active--;
      return n * 2;
    };

    const results = await asyncPool(limit, items, iterator);

    // Concurrency should never exceed the limit
    expect(maxActive).toBeLessThanOrEqual(limit);

    // Results should be in the same order as items (allSettled format)
    expect(results).toHaveLength(items.length);
    expect(results).toEqual([
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 4 },
      { status: 'fulfilled', value: 6 },
      { status: 'fulfilled', value: 8 },
      { status: 'fulfilled', value: 10 },
    ]);
  });

  it('handles rejections and still resolves with allSettled-style results', async () => {
    const items = [1, 2, 3];
    const limit = 2;

    const iterator = async (n) => {
      if (n === 2) {
        throw new Error('boom');
      }
      return n * 10;
    };

    const results = await asyncPool(limit, items, iterator);

    expect(results).toHaveLength(3);

    expect(results[0]).toEqual({
      status: 'fulfilled',
      value: 10,
    });

    expect(results[1].status).toBe('rejected');
    expect(results[1].reason).toBeInstanceOf(Error);
    expect(results[1].reason.message).toBe('boom');

    expect(results[2]).toEqual({
      status: 'fulfilled',
      value: 30,
    });
  });
});
