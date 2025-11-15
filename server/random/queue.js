import { redis } from '@utils/redisClient.js';

const KEY_WAITING = 'random:waiting:v2';   // list of JSON strings (queue of seekers)
const PAIR_PREFIX = 'random:pair:';        // Redis hash per roomId

// Valid age bands we support
const AGE_VALUES = ['TEEN_13_17','ADULT_18_24','ADULT_25_34','ADULT_35_49','ADULT_50_PLUS'];

function isTeen(band) {
  return band === 'TEEN_13_17';
}

/**
 * Adults: both sides must explicitly allow the other's ageBand (mutual opt-in).
 * Teens: only match with teens (never adults).
 */
function compatible(a, b) {
  // Safety: if either side is a teen, both must be teens
  if (isTeen(a.ageBand) || isTeen(b.ageBand)) {
    return isTeen(a.ageBand) && isTeen(b.ageBand);
  }
  // Adults: mutual allow-lists must include the other's band
  const aAllows = Array.isArray(a.allowed) ? a.allowed : [];
  const bAllows = Array.isArray(b.allowed) ? b.allowed : [];
  return aAllows.includes(b.ageBand) && bAllows.includes(a.ageBand);
}

/**
 * Enqueue a user who is looking for a random chat partner.
 * meta: {
 *   socketId: string,
 *   username: string,
 *   userId: number,
 *   ageBand?: string,                 // one of AGE_VALUES
 *   allowed?: string[],               // allowed adult bands (adults only)
 *   wantsAgeFilter?: boolean          // default true; when false, match anyone
 * }
 */
export async function enqueueWaiting(meta) {
  const entry = JSON.stringify({
    socketId: meta.socketId,
    username: meta.username,
    userId: meta.userId,
    ageBand: AGE_VALUES.includes(meta.ageBand) ? meta.ageBand : null,
    // normalize/clean the allow-list to known values (teens never listed)
    allowed: Array.isArray(meta.allowed)
      ? meta.allowed.filter((v) => AGE_VALUES.includes(v) && v !== 'TEEN_13_17')
      : [],
    wantsAgeFilter: meta.wantsAgeFilter !== false, // default ON
    t: Date.now(),
  });
  await redis.rPush(KEY_WAITING, entry);
}

/**
 * Scan the waiting list for the first compatible partner for "me".
 * We check a window of N entries to avoid O(n) scans on large queues.
 *
 * NOTE: Pass the caller's metadata:
 *   { socketId, username, userId, ageBand, allowed, wantsAgeFilter }
 *
 * If "me" is omitted (legacy fallback), we simply pop the tail (no filtering).
 */
export async function tryDequeuePartner(me) {
  // Legacy fallback — if old call sites haven't been updated yet.
  if (!me) {
    const raw = await redis.rPop(KEY_WAITING);
    return raw ? JSON.parse(raw) : null;
  }

  const N = 50; // scan window size
  const items = await redis.lRange(KEY_WAITING, 0, N - 1);

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    let cand;
    try { cand = JSON.parse(raw); } catch { continue; }

    // Skip matching with ourselves (paranoia)
    if (cand.socketId === me.socketId) continue;

    // If either side wants age filtering, enforce compatibility
    const filterOn = (cand.wantsAgeFilter !== false) && (me.wantsAgeFilter !== false);

    if (
      !filterOn ||
      compatible(
        { ageBand: me.ageBand, allowed: me.allowed },
        { ageBand: cand.ageBand, allowed: cand.allowed }
      )
    ) {
      // Remove this candidate by value (LREM count=1), then return it
      await redis.lRem(KEY_WAITING, 1, raw);
      return cand;
    }
  }

  return null;
}

/**
 * Persist a matched pair with a TTL (so later we can read it to save the chat).
 */
export async function savePair(roomId, a, b) {
  const key = `${PAIR_PREFIX}${roomId}`;
  await redis.hSet(key, {
    a: JSON.stringify(a),
    b: JSON.stringify(b),
    createdAt: String(Date.now()),
  });
  // Optional TTL to avoid stale entries
  await redis.expire(key, 60 * 60); // 1 hour
}

export async function getPair(roomId) {
  const key = `${PAIR_PREFIX}${roomId}`;
  const map = await redis.hGetAll(key);
  if (!map || !map.a || !map.b) return null;
  return { a: JSON.parse(map.a), b: JSON.parse(map.b) };
}

export async function deletePair(roomId) {
  const key = `${PAIR_PREFIX}${roomId}`;
  await redis.del(key);
}
