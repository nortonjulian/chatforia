import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// ---- Fake Worker implementation ----
class FakeWorker extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    FakeWorker.instances.push(this);
    this.terminated = false;
  }

  postMessage(taskData) {
    this.lastTask = taskData;
    // simulate async worker behavior
    process.nextTick(() => {
      if (taskData.shouldError) {
        this.emit('error', new Error('boom'));
      } else if (taskData.shouldFail) {
        this.emit('message', { ok: false, err: 'bad' });
      } else {
        this.emit('message', {
          ok: true,
          result: `enc:${taskData.value ?? ''}`,
        });
      }
    });
  }

  terminate() {
    this.terminated = true;
  }
}
FakeWorker.instances = [];

// ---- Mock worker_threads BEFORE importing module under test ----
await jest.unstable_mockModule('node:worker_threads', () => ({
  __esModule: true,
  Worker: FakeWorker,
}));

// ---- Now import CryptoPool & getCryptoPool (they will use FakeWorker) ----
const { CryptoPool, getCryptoPool } = await import('../cryptoPool.js');

describe('CryptoPool', () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
    jest.clearAllMocks();
  });

  it('runs a task using a worker and resolves on ok message', async () => {
    const pool = new CryptoPool(1);

    const result = await pool.run({ value: 'hello' });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        result: 'enc:hello',
      })
    );

    // One worker instance created
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].lastTask).toEqual({ value: 'hello' });
  });

  it('reuses the same worker for multiple queued tasks when pool size is 1', async () => {
    const pool = new CryptoPool(1);

    const p1 = pool.run({ value: 'first' });
    const p2 = pool.run({ value: 'second' });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.result).toBe('enc:first');
    expect(r2.result).toBe('enc:second');

    // Only one worker spawned, reused for both tasks
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects when worker sends a non-ok message', async () => {
    const pool = new CryptoPool(1);

    await expect(
      pool.run({ value: 'oops', shouldFail: true })
    ).rejects.toThrow('bad');

    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects when worker emits an error and terminates the worker', async () => {
    const pool = new CryptoPool(1);

    await expect(
      pool.run({ value: 'err-case', shouldError: true })
    ).rejects.toThrow('boom');

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
});

describe('getCryptoPool', () => {
  it('returns a singleton instance', () => {
    const a = getCryptoPool();
    const b = getCryptoPool();

    expect(a).toBeInstanceOf(CryptoPool);
    expect(b).toBeInstanceOf(CryptoPool);
    expect(a).toBe(b);
  });
});
