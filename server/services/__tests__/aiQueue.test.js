import { describe, it, expect, beforeEach, jest } from '@jest/globals';

beforeEach(() => {
  // Fresh module + env for each test so the top-level constants are re-read
  jest.resetModules();
  delete process.env.AI_MAX_CONCURRENCY;
  delete process.env.AI_MIN_DELAY_MS;
  delete process.env.AI_ROOM_COOLDOWN_MS;
});

describe('enqueueAI', () => {
  it('runs queued tasks sequentially (FIFO) and resolves their results', async () => {
    // Force deterministic behavior: concurrency 1, no delays
    process.env.AI_MAX_CONCURRENCY = '1';
    process.env.AI_MIN_DELAY_MS = '0';
    process.env.AI_ROOM_COOLDOWN_MS = '0';

    const { enqueueAI } = await import('../aiQueue.js');

    const order = [];

    const p1 = enqueueAI({
      roomKey: 'room:1',
      fn: async () => {
        order.push('first');
        return 'result1';
      },
    });

    const p2 = enqueueAI({
      roomKey: 'room:1',
      fn: async () => {
        order.push('second');
        return 'result2';
      },
    });

    const p3 = enqueueAI({
      roomKey: 'room:1',
      fn: async () => {
        order.push('third');
        return 'result3';
      },
    });

    const results = await Promise.all([p1, p2, p3]);

    // Results come back for each task
    expect(results).toEqual(['result1', 'result2', 'result3']);
    // And the tasks themselves ran in FIFO order
    expect(order).toEqual(['first', 'second', 'third']);
  });
});
