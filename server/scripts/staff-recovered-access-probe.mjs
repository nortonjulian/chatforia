import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';

import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import request from 'supertest';

// Only the fresh synthetic harness supplies this signed local reopening gate.
// No listener exists before these checks. This is not a production ingress gate.
assert.equal(process.env.DOTENV_CONFIG_PATH, '/dev/null');
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.pathname, '/staff_old_restore');
const { gate, signature } = JSON.parse(
  readFileSync(process.env.STAFF_REOPEN_GATE, 'utf8')
);
assert.ok(
  typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature),
  'Invalid gate signature encoding'
);
const supplied = Buffer.from(signature, 'hex');
const expected = createHmac('sha256', process.env.STAFF_REOPEN_GATE_KEY)
  .update(JSON.stringify(gate))
  .digest();
assert.ok(
  supplied.length === expected.length && timingSafeEqual(supplied, expected),
  'Invalid local reopen gate'
);
assert.equal(gate.evidenceDigest, process.env.STAFF_REOPEN_DIGEST);
assert.equal(gate.approvedFor, 'synthetic-loopback-only');
assert.equal(gate.reconciliationComplete, true);
assert.equal(gate.credentialsReverified, true);
const { createApp } = await import('../app.js');
const { default: prisma } = await import('../utils/prismaClient.js');
const server = http.createServer(createApp());
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  for (const [id, password] of [
    [1, process.env.STAFF_OLD_PASSWORD],
    [2, process.env.STAFF_OLD_PASSWORD],
    [3, process.env.STAFF_OLD_PASSWORD],
    [3, process.env.STAFF_POST_BACKUP_PASSWORD],
  ])
    await request(server)
      .post('/auth/login')
      .send({ identifier: `old_snapshot_${id}`, password })
      .expect(401);
  for (const token of [
    process.env.STAFF_OLD_SESSION,
    process.env.STAFF_OLD_VERSION_SESSION,
  ])
    await request(server)
      .get('/staff/session')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  const agent = request.agent(server);
  const login = await agent
    .post('/auth/login')
    .send({
      identifier: 'old_snapshot_2',
      password: process.env.STAFF_RECOVERED_PASSWORD,
    })
    .expect(200);
  assert.equal(login.body.mfaRequired, true);
  assert.equal(login.body.token, undefined);
  await agent
    .post('/auth/2fa/login')
    .send({ mfaToken: login.body.mfaToken, code: process.env.STAFF_OLD_BACKUP })
    .expect(400);
  await agent
    .post('/auth/2fa/login')
    .send({
      mfaToken: login.body.mfaToken,
      code: speakeasy.totp({
        secret: process.env.STAFF_OLD_TOTP,
        encoding: 'base32',
      }),
    })
    .expect(400);
  await agent.get('/staff/session').expect(401);
  await agent
    .post('/auth/2fa/login')
    .send({
      mfaToken: login.body.mfaToken,
      code: speakeasy.totp({
        secret: process.env.STAFF_RECOVERED_TOTP,
        encoding: 'base32',
      }),
    })
    .expect(200);
  const session = await agent.get('/staff/session').expect(200);
  assert.equal(session.body.profile, 'ACCESS_ADMIN');
  await agent.get('/staff/assignments').expect(200);
  await agent.get('/staff/users').expect(403);
  await agent.get('/admin/users').expect(403);
  const revoked = await prisma.user.findUnique({ where: { id: 3 } });
  const currentOrdinarySession = jwt.sign(
    {
      id: 3,
      tokenVersion: revoked.tokenVersion,
      mfaVerified: true,
      typ: 'session',
    },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
  await request(server)
    .get('/staff/session')
    .set('Authorization', `Bearer ${currentOrdinarySession}`)
    .expect(403);
  console.log(
    'PASS: reopened synthetic HTTP denies old passwords/MFA/backup/session credentials; current recovered MFA has only its reconciled profile; revoked staff remains denied'
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await prisma.$disconnect();
}
