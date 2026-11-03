import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { freshCluster, artifacts } from './staff-fresh-postgres.mjs';
import { sqlStatements } from './staff-qa-sql.mjs';

if (
  process.env.DOTENV_CONFIG_PATH !== '/dev/null' ||
  process.env.JEST_WORKER_ID !== 'synthetic-shell'
)
  throw Error('Use staff-shell-local.mjs');
Object.assign(process.env, {
  APP_ENC_KEY: randomBytes(32).toString('base64'),
  JWT_SECRET: randomBytes(32).toString('hex'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  STAFF_ACCESS_SIGNING_SECRET: randomBytes(32).toString('hex'),
  STAFF_SECURITY_ENABLED: 'true',
  STAFF_DASHBOARD_ENABLED: 'true',
  STAFF_DASHBOARD_USER_IDS: '3',
  JWT_COOKIE_NAME: 'staff_shell_qa_jwt',
});
const cluster = await freshCluster('source');
try {
  cluster.sql('postgres', 'CREATE DATABASE staff_shell_test');
  process.env.DATABASE_URL = cluster.url('staff_shell_test', 'chatforia_dev');
  const admin = new PrismaClient({
    datasources: { db: { url: cluster.url('staff_shell_test') } },
  });
  const ddl = execFileSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      'server/prisma/schema.prisma',
      '--script',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  for (const sql of sqlStatements(ddl)) await admin.$executeRawUnsafe(sql);
  for (const sql of [
    'CREATE ROLE chatforia_dev LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    'CREATE ROLE chatforia_recovery_issuer NOLOGIN NOINHERIT',
    'CREATE ROLE chatforia_recovery_executor NOLOGIN NOINHERIT',
    ...sqlStatements(
      readFileSync('server/scripts/staff-access-bootstrap-role.sql', 'utf8')
    ),
  ])
    await admin.$executeRawUnsafe(sql);
  for (const name of readdirSync('server/prisma/migrations')
    .filter((n) => n.startsWith('20261102') && n >= '20261102070000')
    .sort())
    for (const sql of sqlStatements(
      readFileSync(`server/prisma/migrations/${name}/migration.sql`, 'utf8')
    ))
      await admin.$executeRawUnsafe(sql);
  await admin.$executeRaw`INSERT INTO staff_security.assertion_secrets(id,key_version,verification_secret) VALUES(1,3,convert_to(${process.env.STAFF_ACCESS_SIGNING_SECRET},'UTF8'))`;
  const { seal } = await import('../utils/secretBox.js');
  const password = `Synthetic-${randomBytes(12).toString('hex')}`;
  const accounts = [
    { id: 1, username: 'qa_founder' },
    { id: 2, username: 'qa_admin' },
    { id: 3, username: 'qa_support' },
    { id: 100, username: 'qa_user' },
  ];
  const secrets = new Map();
  for (const account of accounts) {
    const secret = speakeasy.generateSecret().base32;
    secrets.set(account.username, secret);
    await admin.user.create({
      data: {
        ...account,
        usernameNorm: account.username,
        passwordHash: await bcrypt.hash(password, 10),
        emailVerifiedAt: new Date(),
        twoFactorEnabled: true,
        twoFactorEnrolledAt: new Date(),
        totpSecretEnc: seal(secret),
        displayName: account.id === 100 ? 'Synthetic ordinary user' : null,
      },
    });
  }
  await admin.user.update({ where: { id: 2 }, data: { role: 'ADMIN' } });
  await admin.founderOwnership.create({
    data: { id: 1, userId: 1, verificationRef: 'fresh-shell-only' },
  });
  await admin.staffAssignment.create({
    data: { userId: 3, profile: 'SUPPORT', grantedById: 1, active: true },
  });
  const runtime = new PrismaClient();
  const { assertStaffRuntimeReady } = await import(
    '../security/staffRuntimeReadiness.js'
  );
  await assertStaffRuntimeReady(runtime);
  const frontend = http.createServer();
  await new Promise((resolve) => frontend.listen(5173, '127.0.0.1', resolve));
  const url = `http://localhost:${frontend.address().port}`;
  Object.assign(process.env, {
    FRONTEND_ORIGIN: url,
    FRONTEND_URL: url,
    APP_URL: url,
    CORS_ORIGINS: url,
  });
  const { createApp } = await import('../app.js');
  const outer = express();
  // Only routes needed for the synthetic staff shell are reachable. Paid integrations stay closed.
  outer.use((req, res, next) =>
    /^\/(auth|staff|admin\/users|users|rooms|chatrooms|features|notifications|settings|preferences|status|health)(\/|\?|$)/.test(
      req.url
    )
      ? next()
      : res
          .status(503)
          .json({ error: 'Unavailable in isolated staff rehearsal' })
  );
  outer.use(createApp());
  const api = http.createServer(outer);
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://localhost:${api.address().port}`;
  const cap = randomBytes(24).toString('hex');
  const helper = `/__synthetic/${cap}`;
  const vite = await createServer({
    configFile: false,
    envFile: false,
    envDir: artifacts,
    root: join(process.cwd(), 'client'),
    cacheDir: join(artifacts, 'vite'),
    resolve: {
      alias: {
        '@': join(process.cwd(), 'client/src'),
        '@emoji-mart/data/sets/15/native.json': '@emoji-mart/data',
      },
      dedupe: ['react', 'react-dom', '@mantine/core', '@mantine/hooks'],
    },
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: false,
      fs: { allow: [process.cwd()] },
    },
  });
  const web = express();
  web.use((req, res, next) => {
    if (req.headers.host !== new URL(url).host) return res.sendStatus(403);
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${apiUrl}; frame-src 'none'; form-action 'self'`
    );
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  web.get('/env.js', (_req, res) =>
    res
      .type('js')
      .send(
        `window.__API_URL__=${JSON.stringify(apiUrl)};window.__WS_URL__=${JSON.stringify(apiUrl)};`
      )
  );
  web.get(helper, (_req, res) =>
    res.type('html').send(
      `<html><head><meta http-equiv="refresh" content="10"></head><body><h1>Synthetic local accounts only</h1><p>Password for all accounts: <code>${password}</code></p>${accounts
        .filter((a) => a.id !== 1)
        .map(
          (a) =>
            `<p>${a.username}: current MFA code <code>${speakeasy.totp({ secret: secrets.get(a.username), encoding: 'base32' })}</code></p>`
        )
        .join(
          ''
        )}<p>Codes refresh every 10 seconds; use within their 30 second window.</p><a href="/">Open actual application</a><p>Admin: /admin/users. Support: /staff. User is the denied-access account.</p></body></html>`
    )
  );
  web.use(async (req, res, next) => {
    if (
      req.method === 'GET' &&
      !req.path.includes('.') &&
      !req.path.startsWith('/@') &&
      !req.path.startsWith('/node_modules')
    ) {
      let html = readFileSync('client/index.html', 'utf8').replace(
        /<link[^>]*(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/g,
        ''
      );
      res.type('html').send(await vite.transformIndexHtml(req.url, html));
    } else next();
  });
  web.use(vite.middlewares);
  frontend.on('request', web);
  const session = {
    url,
    apiUrl,
    helperUrl: url + helper,
    pid: process.pid,
    artifacts,
    expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
    syntheticOnly: true,
  };
  writeFileSync(
    '/tmp/chatforia-staff-shell-session.json',
    JSON.stringify(session, null, 2),
    { mode: 0o600 }
  );
  console.log('LOCAL SHELL READY', JSON.stringify(session));
  let closing = false;
  async function stop() {
    if (closing) return;
    closing = true;
    await vite.close();
    frontend.closeAllConnections();
    api.closeAllConnections();
    await Promise.all([
      new Promise((r) => frontend.close(r)),
      new Promise((r) => api.close(r)),
      runtime.$disconnect(),
      admin.$disconnect(),
    ]);
    cluster.stop();
    process.exit(0);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setTimeout(stop, 4 * 3600000);
  try {
    const { browserQa } = await import('./staff-shell-browser-qa.mjs');
    await browserQa({ url, apiUrl, password, secrets, artifacts, admin });
  } catch (error) {
    console.error('SHELL QA FAILED:', error.message);
  }
} catch (error) {
  cluster.stop();
  console.error('Synthetic harness startup failed:', error.message);
  process.exit(1);
}
