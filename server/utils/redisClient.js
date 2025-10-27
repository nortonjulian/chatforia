// server/utils/redisClient.js

import { createClient } from 'redis';

const IS_TEST = !!process.env.JEST_WORKER_ID;

// We'll declare all the exports up front, then assign them based on IS_TEST.
let redis;
let redisKv;
let redisPub;
let redisSub;
let ensureRedis;
let rSetJSON;
let rGetJSON;
// test-only helper (undefined in prod)
let __redisTestStore;

/**
 * TEST MODE (Jest):
 * - no network
 * - in-memory Map as fake Redis
 * - ensureRedis() returns an object w/ get() and setEx()
 */
if (IS_TEST) {
  const _store = new Map();

  const fakeClient = {
    async get(key) {
      return _store.has(key) ? _store.get(key) : null;
    },
    async setEx(key, _ttlSec, value) {
      _store.set(key, value);
    },
    // minimal compat so other code doesn't explode if it calls .connect() in tests
    async connect() {
      return;
    },
    on() {
      // swallow .on('error', ...) etc
      return;
    },
  };

  // all four "clients" just point to our stub
  redis = fakeClient;
  redisKv = fakeClient;
  redisPub = fakeClient;
  redisSub = fakeClient;

  ensureRedis = async () => {
    // translate.js does:
    //   const r = await ensureRedis();
    //   r.get(...)
    //   r.setEx(...)
    // so we just return the fake client directly
    return fakeClient;
  };

  // JSON helpers in tests just serialize into the same _store under the hood
  rSetJSON = async (key, val, ttlSec) => {
    // ttlSec ignored in test mode
    const payload = JSON.stringify(val);
    _store.set(key, payload);
  };

  rGetJSON = async (key) => {
    const raw = _store.get(key);
    return raw ? JSON.parse(raw) : null;
  };

  // expose the backing Map so translate.test.js can assert what's cached
  __redisTestStore = () => _store;

} else {
  /**
   * PROD / DEV MODE:
   * - real redis clients
   * - ensureRedis() lazily connects once, returns redisKv
   */
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  redisPub = createClient({ url });
  redisSub = createClient({ url });
  redis = createClient({ url });
  redisKv = createClient({ url });

  // basic error logging
  [redisPub, redisSub, redis, redisKv].forEach((c, i) => {
    c.on('error', (e) => {
      console.error(`Redis client ${i} error:`, e);
    });
  });

  let ready = false;

  ensureRedis = async () => {
    // translate.js expects an object with .get() / .setEx(), so we just hand
    // back redisKv directly
    if (!ready) {
      await Promise.all([
        redis.connect(),
        redisPub.connect(),
        redisSub.connect(),
        redisKv.connect(),
      ]);
      ready = true;
    }
    return redisKv;
  };

  // prod JSON helpers go through redisKv
  rSetJSON = async (key, val, ttlSec) => {
    const payload = JSON.stringify(val);
    if (ttlSec) {
      return redisKv.set(key, payload, { EX: ttlSec });
    }
    return redisKv.set(key, payload);
  };

  rGetJSON = async (key) => {
    const s = await redisKv.get(key);
    return s ? JSON.parse(s) : null;
  };

  // __redisTestStore stays undefined in prod
}

// finally, export the vars / functions we prepared
export {
  redis,
  redisKv,
  redisPub,
  redisSub,
  ensureRedis,
  rSetJSON,
  rGetJSON,
  __redisTestStore,
};
