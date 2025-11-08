let fakeRedis;

const ORIGINAL_ENV = process.env;

function makeFakeRedis() {
  const lists = new Map();   // key -> array of JSON strings
  const hashes = new Map();  // key -> { field: value }
  const expiries = new Map();// key -> seconds

  return {
    // List ops
    async rPush(key, val) {
      const arr = lists.get(key) || [];
      arr.push(val);
      lists.set(key, arr);
    },
    async lRange(key, start, end) {
      const arr = lists.get(key) || [];
      const realEnd = end < 0 ? arr.length - 1 : end;
      return arr.slice(start, realEnd + 1);
    },
    async lRem(key, count, val) {
      const arr = lists.get(key) || [];
      if (!arr.length) return 0;
      let removed = 0;
      if (count >= 0) {
        for (let i = 0; i < arr.length && removed < count; i++) {
          if (arr[i] === val) {
            arr.splice(i, 1);
            removed++;
            i--;
          }
        }
      } else {
        for (let i = arr.length - 1; i >= 0 && removed < Math.abs(count); i--) {
          if (arr[i] === val) {
            arr.splice(i, 1);
            removed++;
          }
        }
      }
      lists.set(key, arr);
      return removed;
    },
    async rPop(key) {
      const arr = lists.get(key) || [];
      const v = arr.pop();
      lists.set(key, arr);
      return v ?? null;
    },

    // Hash ops
    async hSet(key, fields) {
      const obj = hashes.get(key) || {};
      Object.assign(obj, fields);
      hashes.set(key, obj);
    },
    async hGetAll(key) {
      return hashes.get(key) || {};
    },

    // Other
    async expire(key, seconds) {
      expiries.set(key, seconds);
    },
    async del(key) {
      hashes.delete(key);
      // leaving lists alone; not needed for pair keys
    },

    // test helpers
    _lists: lists,
    _hashes: hashes,
    _expiries: expiries,
    _reset() {
      lists.clear();
      hashes.clear();
      expiries.clear();
    },
  };
}

// Mock redis client module with our in-memory fake
const mockRedisModule = () => {
  fakeRedis = makeFakeRedis();
  jest.doMock('../../utils/redisClient.js', () => ({
    __esModule: true,
    redis: fakeRedis,
  }));
};

const reload = async () => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  mockRedisModule();
  return import('../queue.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks?.();
  fakeRedis?._reset();
});

describe('random queue', () => {
  test('enqueueWaiting normalizes ageBand, allowed, wantsAgeFilter (default true)', async () => {
    const { enqueueWaiting } = await reload();

    await enqueueWaiting({
      socketId: 's1',
      username: 'a',
      userId: 1,
      ageBand: 'NOT_A_VALID_BAND',
      allowed: ['TEEN_13_17', 'ADULT_25_34', 'BOGUS'],
      // wantsAgeFilter omitted → default true
    });

    // Read back via legacy rPop path by peeking internal list
    const key = 'random:waiting:v2';
    const stored = fakeRedis._lists.get(key);
    expect(stored).toHaveLength(1);

    const parsed = JSON.parse(stored[0]);
    expect(parsed).toMatchObject({
      socketId: 's1',
      username: 'a',
      userId: 1,
      ageBand: null, // invalid band -> null
      allowed: ['ADULT_25_34'], // teen removed; bogus removed
      wantsAgeFilter: true, // default ON
    });
    expect(typeof parsed.t).toBe('number');
  });

  test('tryDequeuePartner (legacy): pops tail when no "me" provided', async () => {
    const { enqueueWaiting, tryDequeuePartner } = await reload();

    await enqueueWaiting({ socketId: 's1', username: 'a', userId: 1 });
    await enqueueWaiting({ socketId: 's2', username: 'b', userId: 2 });

    const popped = await tryDequeuePartner(); // legacy path
    expect(popped).toMatchObject({ socketId: 's2', username: 'b', userId: 2 });

    // Next pop returns first
    const popped2 = await tryDequeuePartner();
    expect(popped2).toMatchObject({ socketId: 's1', username: 'a', userId: 1 });

    // Empty after two pops
    const popped3 = await tryDequeuePartner();
    expect(popped3).toBeNull();
  });

  test('adult matching requires mutual allow-lists (compatible)', async () => {
    const { enqueueWaiting, tryDequeuePartner } = await reload();

    // Candidate in queue (adult 18-24) allows 25-34
    await enqueueWaiting({
      socketId: 'cand',
      username: 'c',
      userId: 200,
      ageBand: 'ADULT_18_24',
      allowed: ['ADULT_25_34'],
      wantsAgeFilter: true,
    });

    // Me: adult 25-34, allows 18-24
    const me = {
      socketId: 'me',
      username: 'm',
      userId: 100,
      ageBand: 'ADULT_25_34',
      allowed: ['ADULT_18_24'],
      wantsAgeFilter: true,
    };

    const partner = await tryDequeuePartner(me);
    expect(partner).toMatchObject({ socketId: 'cand', userId: 200 });

    // Ensure it was LREM’d (queue now empty)
    const key = 'random:waiting:v2';
    expect((fakeRedis._lists.get(key) || []).length).toBe(0);
  });

  test('teens only match teens; adult vs teen should skip', async () => {
    const { enqueueWaiting, tryDequeuePartner } = await reload();

    // Queue: a teen
    await enqueueWaiting({
      socketId: 'teen1',
      username: 't1',
      userId: 11,
      ageBand: 'TEEN_13_17',
      allowed: [], // ignored for teens
      wantsAgeFilter: true,
    });

    // Me: adult
    const meAdult = {
      socketId: 'meA',
      username: 'mA',
      userId: 1,
      ageBand: 'ADULT_25_34',
      allowed: ['ADULT_18_24', 'ADULT_25_34'],
      wantsAgeFilter: true,
    };

    const none = await tryDequeuePartner(meAdult);
    expect(none).toBeNull();

    // Add another teen → should match
    await enqueueWaiting({
      socketId: 'teen2',
      username: 't2',
      userId: 12,
      ageBand: 'TEEN_13_17',
      allowed: [],
      wantsAgeFilter: true,
    });

    const meTeen = {
      socketId: 'meT',
      username: 'mT',
      userId: 99,
      ageBand: 'TEEN_13_17',
      allowed: [],
      wantsAgeFilter: true,
    };

    const partnerTeen = await tryDequeuePartner(meTeen);
    expect(partnerTeen).toMatchObject({ socketId: 'teen1', userId: 11 });
  });

  test('if either side disables filtering (wantsAgeFilter=false) → bypass compatibility', async () => {
    const { enqueueWaiting, tryDequeuePartner } = await reload();

    // Queue: adult that does NOT allow my band, but filter disabled
    await enqueueWaiting({
      socketId: 'candNF',
      username: 'c',
      userId: 3,
      ageBand: 'ADULT_18_24',
      allowed: [], // wouldn't mutually match
      wantsAgeFilter: false, // disables
    });

    const me = {
      socketId: 'me',
      username: 'm',
      userId: 2,
      ageBand: 'ADULT_25_34',
      allowed: [], // also doesn't matter because bypass
      wantsAgeFilter: true,
    };

    const partner = await tryDequeuePartner(me);
    expect(partner).toMatchObject({ socketId: 'candNF', userId: 3 });
  });

  test('skips self entries (same socketId) and continues scanning', async () => {
    const { enqueueWaiting, tryDequeuePartner } = await reload();

    await enqueueWaiting({ socketId: 'meSock', username: 'self', userId: 1, ageBand: 'ADULT_25_34', allowed: ['ADULT_18_24'] });
    await enqueueWaiting({ socketId: 'other', username: 'o', userId: 2, ageBand: 'ADULT_18_24', allowed: ['ADULT_25_34'] });

    const me = {
      socketId: 'meSock',
      username: 'me',
      userId: 1,
      ageBand: 'ADULT_25_34',
      allowed: ['ADULT_18_24'],
      wantsAgeFilter: true,
    };

    const partner = await tryDequeuePartner(me);
    expect(partner).toMatchObject({ socketId: 'other', userId: 2 });
  });

  test('no compatible candidate within first 50 → returns null', async () => {
    const { enqueueWaiting, tryDequeuePartner } = await reload();

    // Put 2 incompatible adults into queue (both filter on, no mutual allows)
    await enqueueWaiting({ socketId: 'a1', username: 'a1', userId: 10, ageBand: 'ADULT_18_24', allowed: ['ADULT_18_24'], wantsAgeFilter: true });
    await enqueueWaiting({ socketId: 'a2', username: 'a2', userId: 11, ageBand: 'ADULT_50_PLUS', allowed: ['ADULT_50_PLUS'], wantsAgeFilter: true });

    const me = {
      socketId: 'me',
      username: 'me',
      userId: 1,
      ageBand: 'ADULT_25_34',
      allowed: ['ADULT_25_34'],
      wantsAgeFilter: true,
    };

    const res = await tryDequeuePartner(me);
    expect(res).toBeNull();
  });

  test('savePair / getPair / deletePair roundtrip', async () => {
    const { savePair, getPair, deletePair } = await reload();

    const a = { socketId: 's1', userId: 1 };
    const b = { socketId: 's2', userId: 2 };

    await savePair('room-xyz', a, b);

    // expire() set to 1h for the key
    expect(fakeRedis._expiries.get('random:pair:room-xyz')).toBe(60 * 60);

    const got = await getPair('room-xyz');
    expect(got).toEqual({ a, b });

    await deletePair('room-xyz');
    const afterDel = await getPair('room-xyz');
    expect(afterDel).toBeNull();
  });
});
