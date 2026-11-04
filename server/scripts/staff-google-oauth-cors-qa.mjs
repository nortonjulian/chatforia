import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import request from 'supertest';
const session = JSON.parse(
  readFileSync('/tmp/chatforia-staff-shell-session.json', 'utf8')
);
assert.equal(session.syntheticOnly, true);
assert.equal(session.apiUrl, 'http://localhost:5002');
assert.equal(
  JSON.parse(readFileSync(session.artifacts + '/synthetic-only.json', 'utf8'))
    .pid,
  session.pid
);
const agent = request.agent(session.apiUrl),
  checks = [];
const csrf = await agent
  .get('/auth/csrf')
  .set('Origin', session.apiUrl)
  .expect(200);
assert.equal(typeof csrf.body.csrfToken, 'string');
checks.push('API-origin GET obtains CSRF cookie/token without logging values');
for (const header of [null, 'invalid-csrf-token']) {
  let attempt = agent
    .post('/auth/2fa/login')
    .set('Origin', session.apiUrl)
    .set('X-Requested-With', 'XMLHttpRequest');
  if (header) attempt = attempt.set('X-XSRF-TOKEN', header);
  const response = await attempt.send({ browserMfa: true }).expect(403);
  assert.equal(response.body.reason, 'csrf');
}
checks.push('Missing and invalid CSRF headers remain rejected');
const allowed = await agent
  .post('/auth/2fa/login')
  .set('Origin', session.apiUrl)
  .set('X-Requested-With', 'XMLHttpRequest')
  .set('X-XSRF-TOKEN', csrf.body.csrfToken)
  .send({ browserMfa: true })
  .expect(400);
assert.equal(allowed.body.error, 'Missing fields');
checks.push(
  'Correct API-origin cookie/header reaches MFA handler; missing challenge cannot authenticate'
);
for (const origin of ['http://untrusted.invalid', 'http://localhost:5174']) {
  const response = await agent
    .post('/auth/2fa/login')
    .set('Origin', origin)
    .set('X-Requested-With', 'XMLHttpRequest')
    .set('X-XSRF-TOKEN', csrf.body.csrfToken)
    .send({ browserMfa: true })
    .expect(403);
  assert.equal(response.body.error, 'Forbidden');
}
checks.push(
  'Untrusted and unrelated localhost origins remain rejected before MFA'
);
writeFileSync(
  '/tmp/chatforia-google-cors-report.json',
  JSON.stringify(
    {
      checks,
      completed: true,
      syntheticOnly: true,
      applicationPid: session.pid,
    },
    null,
    2
  ),
  { mode: 0o600 }
);
for (const check of checks) console.log('PASS:', check);
