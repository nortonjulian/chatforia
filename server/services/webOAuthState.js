import { randomBytes, createHash } from 'node:crypto';
import { ensureRedis } from '../utils/redisClient.js';

export const OAUTH_STATE_TTL_SECONDS = 600;
const PREFIX = 'chatforia:oauth:web:v1:';
const HEX = /^[a-f0-9]{64}$/;

// Check browser, provider, and expiration BEFORE deleting. Redis executes this
// script atomically, so two API workers cannot both consume the same state.
export const CONSUME_OAUTH_STATE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local flow = cjson.decode(raw)
if flow.provider ~= ARGV[1] or flow.browserHash ~= ARGV[2] then return false end
if tonumber(flow.expiresAt) <= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  return false
end
redis.call('DEL', KEYS[1])
return raw
`;

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function cookieSettings(req) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(req.secure);
  return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/' };
}
function cookieName(req, provider) {
  return `${cookieSettings(req).secure ? '__Host-' : ''}cf_oauth_${provider}`;
}
function invalidState() {
  const error = new Error('Invalid or expired OAuth state');
  error.code = 'invalid_oauth_state';
  return error;
}

export function createWebOAuthState({ getClient = ensureRedis, now = Date.now } = {}) {
  async function begin(req, res, { provider, next, referralCode }) {
    if (!['google', 'apple'].includes(provider)) throw new Error('Unsupported OAuth provider');
    const state = randomBytes(32).toString('hex');
    const browser = randomBytes(32).toString('hex');
    const flow = {
      provider, next,
      referralCode: typeof referralCode === 'string' && referralCode.length <= 40
        ? referralCode : null,
      browserHash: hash(browser),
      expiresAt: now() + OAUTH_STATE_TTL_SECONDS * 1000,
      nonce: provider === 'apple' ? randomBytes(32).toString('hex') : null,
    };
    const client = await getClient();
    await client.setEx(PREFIX + hash(state), OAUTH_STATE_TTL_SECONDS, JSON.stringify(flow));
    res.cookie(cookieName(req, provider), browser, {
      ...cookieSettings(req), maxAge: OAUTH_STATE_TTL_SECONDS * 1000,
    });
    return { state, nonce: flow.nonce };
  }

  async function consume(req, res, provider, state) {
    const browser = req.cookies?.[cookieName(req, provider)];
    if (typeof state !== 'string' || !HEX.test(state) ||
        typeof browser !== 'string' || !HEX.test(browser)) throw invalidState();
    const client = await getClient();
    const raw = await client.eval(CONSUME_OAUTH_STATE, {
      keys: [PREFIX + hash(state)],
      arguments: [provider, hash(browser), String(now())],
    });
    if (!raw) throw invalidState();
    const flow = JSON.parse(raw);
    res.clearCookie(cookieName(req, provider), cookieSettings(req));
    return flow;
  }
  return { begin, consume };
}

export const webOAuthState = createWebOAuthState();
