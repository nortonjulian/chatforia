// server/__tests__/mocks/redisClient.dynamic.js
// Shared in-memory "redis" used by SUT and tests.
// Import this in tests to reset/inspect between cases.

const lists = new Map();    // key -> array of JSON strings
const hashes = new Map();   // key -> { field: value }
const expiries = new Map(); // key -> seconds

function makeFakeRedis() {
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
      // lists untouched; not needed for pair keys
    },

    // test-only access
    _lists: lists,
    _hashes: hashes,
    _expiries: expiries,
  };
}

export const redis = makeFakeRedis();

// Handy reset hook for tests
export function __resetRedisMock() {
  lists.clear();
  hashes.clear();
  expiries.clear();
}
