import assert from 'node:assert/strict';
import http from 'node:http';

import request from 'supertest';
import speakeasy from 'speakeasy';

// Invoked only by the fresh-cluster rehearsal with a sanitized synthetic env.
// Importing the real app never loads a developer/production dotenv file.
assert.equal(process.env.STAFF_SYNTHETIC_AUTH_PROBE, 'fresh-cluster-only');
assert.equal(process.env.DOTENV_CONFIG_PATH, '/dev/null');
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.pathname, '/staff_old_source');
const { createApp } = await import('../app.js');
const server = http.createServer(createApp());
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const agent = request.agent(server);
  await agent.get('/admin/users').expect(401);
  const login = await agent
    .post('/auth/login')
    .send({
      identifier: 'old_snapshot_3',
      password: process.env.STAFF_SYNTHETIC_PASSWORD,
    })
    .expect(200);
  assert.equal(login.body.mfaRequired, true);
  assert.equal(login.body.token, undefined);
  assert.equal(typeof login.body.mfaToken, 'string');
  const completed = await agent
    .post('/auth/2fa/login')
    .send({
      mfaToken: login.body.mfaToken,
      code: speakeasy.totp({
        secret: process.env.STAFF_SYNTHETIC_TOTP,
        encoding: 'base32',
      }),
    })
    .expect(200);
  assert.equal(typeof completed.body.token, 'string');
  assert.equal(
    JSON.stringify(completed.body.user).includes('totpSecretEnc'),
    false
  );
  const session = await agent.get('/staff/session').expect(200);
  assert.equal(session.body.profile, 'SUPPORT');
  await agent.get('/staff/users').expect(200);
  await agent.get('/admin/users').expect(403);
  console.log(
    'PASS: real app factory/password/TOTP/cookie session/staff routes and admin denial on synthetic runtime DB'
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
