import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { buildCsrf, csrfOnlyForCookieAuth } from '../middleware/csrf.js';
import { createStaffRouter } from '../routes/staff.js';

// The caller supplies its verified, rollback-only Prisma transaction. No
// connection or persistent fixtures are created by this HTTP acceptance helper.
export async function verifyStaffApi(tx, pass) {
  const db = {
    user: tx.user,
    staffAssignment: tx.staffAssignment,
    report: tx.report,
    auditLog: tx.auditLog,
    staffAccessEvent: tx.staffAccessEvent,
    $transaction: async (callback) => {
      await tx.$executeRawUnsafe('SAVEPOINT staff_api');
      try {
        const result = await callback(tx);
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT staff_api');
        return result;
      } catch (error) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT staff_api');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT staff_api');
        throw error;
      }
    },
  };
  const token = (id, tokenVersion, mfaVerified = true) =>
    jwt.sign(
      { id, tokenVersion, mfaVerified, typ: 'session' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '5m' }
    );
  const manager = token(17, 0),
    support = token(16, 5),
    futureRevoked = token(18, 2);
  process.env.STAFF_DASHBOARD_ENABLED = 'true';
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(csrfOnlyForCookieAuth(buildCsrf({ isProd: false })));
  app.get('/csrf', (req, res) => res.json({ csrfToken: req.csrfToken() }));
  app.use(
    '/staff',
    createStaffRouter({
      db,
      authenticate: (req, res, next) => requireAuth(req, res, next, tx),
    })
  );
  app.use((error, _req, res, _next) =>
    res
      .status(error.code === 'EBADCSRFTOKEN' ? 403 : 500)
      .json({ error: 'Request rejected' })
  );
  const call = (method, path, auth = manager) =>
    request(app)
      [method](path)
      .set('Authorization', `Bearer ${auth}`)
      .timeout(5000);

  assert.equal((await request(app).get('/staff/session')).status, 401);
  assert.equal(
    (await call('get', '/staff/session', manager + 'tampered')).status,
    401
  );
  assert.equal(
    (await call('get', '/staff/session', token(17, 0, false))).status,
    403
  );
  const session = await call('get', '/staff/session');
  assert.equal(session.status, 200);
  assert.equal(session.body.profile, 'ACCESS_ADMIN');
  assert.equal(session.headers['cache-control'], 'no-store');
  pass(
    'Real JWT authentication rejects missing, tampered and non-MFA sessions'
  );
  assert.equal((await call('get', '/staff/users')).status, 403);
  const users = await call('get', '/staff/users', support);
  assert.equal(users.status, 200);
  assert.ok(users.body.items.length > 0);
  assert.ok(
    users.body.items.every((row) =>
      Object.keys(row).every((key) =>
        ['id', 'username', 'role', 'isBanned'].includes(key)
      )
    )
  );
  pass(
    'Real API permission boundaries and user-field whitelist hold against the runtime database'
  );

  await tx.report.createMany({
    data: [9000028, 9000029].map((id) => ({
      id,
      reporterId: 17,
      reportedUserId: 16,
      decryptedContent: 'Isolated QA report',
      reason: 'QA verification',
    })),
  });
  const csrf = await request(app).get('/csrf');
  const secretCookie = csrf.headers['set-cookie'][0].split(';')[0];
  const cookies = `${secretCookie}; foria_jwt=${support}; XSRF-TOKEN=${csrf.body.csrfToken}`;
  const resolution = { reason: 'Verified isolated report resolution' };
  const browser = () =>
    request(app)
      .post('/staff/reports/9000028/resolve')
      .set('Cookie', cookies)
      .send(resolution)
      .timeout(5000);
  assert.equal((await browser()).status, 403);
  assert.equal(
    (await browser().set('Authorization', `Bearer ${manager}`)).status,
    403
  );
  const resolved = await browser().set('X-CSRF-Token', csrf.body.csrfToken);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.changed, true);
  assert.equal(
    (await tx.report.findUnique({ where: { id: 9000028 } })).status,
    'RESOLVED'
  );
  assert.equal(
    await tx.auditLog.count({
      where: { action: 'REPORT_RESOLVED', resourceId: '9000028' },
    }),
    1
  );
  assert.equal(
    (
      await call('post', '/staff/reports/9000028/resolve', support).send(
        resolution
      )
    ).body.changed,
    false
  );
  assert.equal(
    await tx.auditLog.count({
      where: { action: 'REPORT_RESOLVED', resourceId: '9000028' },
    }),
    1
  );
  pass(
    'Browser CSRF rejects cookie-only tokens and Bearer bypass; authenticated resolution is audited once'
  );

  await tx.$executeRawUnsafe('RESET ROLE');
  await tx.$executeRawUnsafe(
    "CREATE FUNCTION staff_security.qa_report_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'REPORT_RESOLVED' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$"
  );
  await tx.$executeRawUnsafe(
    'CREATE TRIGGER qa_report_audit_failure BEFORE INSERT ON public."AuditLog" FOR EACH ROW EXECUTE FUNCTION staff_security.qa_report_audit_failure()'
  );
  await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
  assert.equal(
    (
      await call('post', '/staff/reports/9000029/resolve', support).send(
        resolution
      )
    ).status,
    503
  );
  assert.equal(
    (await tx.report.findUnique({ where: { id: 9000029 } })).status,
    'OPEN'
  );
  assert.equal(
    await tx.auditLog.count({
      where: { action: 'REPORT_RESOLVED', resourceId: '9000029' },
    }),
    0
  );
  await tx.$executeRawUnsafe('RESET ROLE');
  await tx.$executeRawUnsafe(
    'DROP TRIGGER qa_report_audit_failure ON public."AuditLog"'
  );
  await tx.$executeRawUnsafe(
    'DROP FUNCTION staff_security.qa_report_audit_failure()'
  );
  await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
  pass('Real report API rolls back resolution when its mandatory audit fails');

  assert.equal(
    (
      await call('post', '/staff/assignments/16/grant').send({
        profile: 'CTO',
        reason: 'Forged elevated scope',
        actorUserId: 13,
      })
    ).status,
    400
  );
  // A genuine route grant changes the profile, invalidating this old support
  // session. A replayed profile change is a no-op with no extra history.
  const grant = await call('post', '/staff/assignments/16/grant').send({
    profile: 'SENIOR_ENGINEER',
    reason: 'API integrated protected profile change',
    actorUserId: 13,
    authentication: { tokenVersion: 999, mfaVerified: false },
  });
  assert.equal(grant.status, 200);
  assert.equal(grant.body.sessionsRevoked, true);
  assert.equal((await call('get', '/staff/session', support)).status, 401);
  pass(
    'Real grant API ignores forged actor/session claims and invalidates the target session'
  );

  delete process.env.STAFF_DASHBOARD_ENABLED;
  assert.equal((await call('get', '/staff/session')).status, 404);
  assert.equal(process.env.STAFF_SECURITY_ENABLED, 'true');
  process.env.STAFF_DASHBOARD_ENABLED = 'true';
  pass(
    'Dashboard containment switch closes authenticated APIs without disabling protected authentication'
  );
  // Called after the parent harness revokes user 18 and changes actor version.
  return async () => {
    assert.equal(
      (await call('get', '/staff/session', futureRevoked)).status,
      401
    );
    assert.equal(
      (
        await call('post', '/staff/assignments/16/revoke').send({
          reason: 'Old actor session must fail',
        })
      ).status,
      401
    );
    pass(
      'Real HTTP sessions lose access immediately after revocation or session-version change'
    );
  };
}
