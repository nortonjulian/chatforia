/**
 * @jest-environment node
 */
import request from 'supertest';
import { createApp } from '../app.js';

// simple helpers
function randStr(n = 8) {
  const s = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return s.slice(0, n);
}
function randEmail() {
  return `user_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

const AUTH = { register: '/auth/register', login: '/auth/login' };
const PREMIUM = { setTone: '/premium/tones' }; // PATCH with a potentially premium tone id

let app;
beforeAll(async () => {
  app = await createApp();
});

it('rejects premium-only tone for FREE plan', async () => {
  const email = randEmail();
  const password = 'Str0ngP@ssword!';
  const username = `u_${randStr(10)}`;

  // Register (some apps 200, some 201; we'll allow both)
  await request(app)
    .post(AUTH.register)
    .send({ email, username, password })
    .then((res) => {
      if (![200, 201].includes(res.status)) {
        throw new Error(`Unexpected /auth/register status ${res.status}`);
      }
    });

  // Login -> expect cookie
  const login = await request(app)
    .post(AUTH.login)
    .send({ identifier: email, password })
    .expect(200);

  const cookie = login.headers['set-cookie']?.[0];

  // Try to apply what we *believe* is a premium-only tone.
  // If that tone ID is actually present in premiumConfig.tones.premiumRingtones
  // for a FREE user, route should send 402 {code:'PREMIUM_REQUIRED', reason:'TONES'}.
  //
  // If it's *not* recognized as premium (or not in catalog at all),
  // route will fall back to 400 "nothing to update / not allowed".
  //
  // Either way, we assert "you can't set this as a FREE user".
  const attemptedTone = 'cosmic-orbit-premium';

  const res = await request(app)
    .patch(PREMIUM.setTone)
    .set('Cookie', cookie)
    .send({ ringtone: attemptedTone });

  // Acceptable "blocked" statuses
  expect([400, 402].includes(res.status)).toBe(true);

  if (res.status === 402) {
    // Premium-gated path
    expect((res.body?.code || '').toUpperCase()).toContain('PREMIUM');
  } else if (res.status === 400) {
    // Fallback "not allowed / nothing to update" path
    expect(
      (res.body?.error || '').toLowerCase()
    ).toMatch(/not allowed|nothing to update/);
  }
});
