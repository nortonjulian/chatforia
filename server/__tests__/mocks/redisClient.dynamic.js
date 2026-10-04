// server/__tests__/mocks/redisClient.dynamic.js
// Shared in-memory "redis" used by SUT and tests.
// Import this in tests to reset/inspect between cases.

const lists = new Map();    // key -> array of JSON strings
const hashes = new Map();   // key -> { field: value }
const expiries = new Map(); // key -> seconds
const values = new Map();   // string key/value operations (OAuth state)
const deadlines = new Map(); // key -> expiration timestamp in milliseconds

function readValue(key) {
  if (deadlines.has(key) && deadlines.get(key) <= Date.now()) {
    values.delete(key);
    deadlines.delete(key);
    expiries.delete(key);
  }
  return values.get(key) ?? null;
}

function makeFakeRedis() {
  return {
    // Key/value ops used by server-stored OAuth transactions.
    async get(key) {
      return readValue(key);
    },
    async setEx(key, seconds, value) {
      values.set(key, value);
      expiries.set(key, seconds);
      deadlines.set(key, Date.now() + seconds * 1000);
      return 'OK';
    },
    async eval(script, { keys, arguments: args }) {
      // Explicitly emulate the OAuth consume script, not arbitrary Lua.
      if (typeof script !== 'string' ||
          !script.includes('flow.browserHash ~= ARGV[2]') || keys.length !== 1) {
        throw new Error('Unsupported Redis Lua script in test mock');
      }
      const raw = readValue(keys[0]);
      if (!raw) return null;
      const flow = JSON.parse(raw);
      if (flow.provider !== args[0] || flow.browserHash !== args[1]) return null;
      // No await between checking and removing: concurrent consumers get one winner.
      values.delete(keys[0]);
      deadlines.delete(keys[0]);
      expiries.delete(keys[0]);
      return flow.expiresAt > Number(args[2]) ? raw : null;
    },

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
      if (values.has(key)) deadlines.set(key, Date.now() + seconds * 1000);
    },
    async del(key) {
      hashes.delete(key);
      values.delete(key);
      deadlines.delete(key);
      expiries.delete(key);
      // lists untouched; not needed for pair keys
    },

    // test-only access
    _lists: lists,
    _hashes: hashes,
    _expiries: expiries,
  };
}

export const redis = makeFakeRedis();
export const redisKv = redis;

// Match the production named export so Jest's moduleNameMapper can load
// services/webOAuthState.js without connecting to a real Redis server.
export async function ensureRedis() {
  return redisKv;
}

// Handy reset hook for tests
export function __resetRedisMock() {
  lists.clear();
  hashes.clear();
  expiries.clear();
  values.clear();
  deadlines.clear();
}
