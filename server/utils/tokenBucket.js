const buckets = new Map();

export function allow(userId, rate = 8, perMs = 10_000) {
  const now = Date.now();
  let b = buckets.get(userId);
  if (!b) b = { tokens: rate, last: now };

  const elapsed = now - b.last;
  b.tokens = Math.min(rate, b.tokens + (elapsed / perMs) * rate);
  b.last = now;

  if (b.tokens < 1) {
    buckets.set(userId, b);
    return false;
  }

  b.tokens -= 1;
  buckets.set(userId, b);
  return true;
}

// ⬇⬇ test-only helper
export function __resetForTests() {
  buckets.clear();
}
