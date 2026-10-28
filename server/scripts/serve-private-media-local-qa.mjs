/**
 * Standalone disposable private-message media QA server.
 *
 * Only localhost:5502 and the explicitly named local QA PostgreSQL database
 * are permitted. No production app, cloud storage or provider integrations.
 *
 * QA_DATABASE_URL='postgresql://juliannorton@127.0.0.1:5432/chatforia_private_media_test_20261027' \
 *   node server/scripts/serve-private-media-local-qa.mjs
 *
 * Ctrl+C shuts down the local HTTP listener and removes created fixtures.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const NAME = 'chatforia_private_media_test_20261027';
const raw = process.env.QA_DATABASE_URL;
if (!raw || process.env.NODE_ENV === 'production') {
  throw new Error('Explicit QA_DATABASE_URL required. Production mode forbidden.');
}
const url = new URL(raw);
if (url.protocol !== 'postgresql:' &&
    url.protocol !== 'postgres:') throw new Error('PostgreSQL required');
if (url.hostname !== '127.0.0.1' || url.port !== '5432' ||
    url.username !== 'juliannorton' ||
    decodeURIComponent(url.pathname) !== '/' + NAME ||
    url.search || url.hash) {
  throw new Error('Refusing non-local/non-QA database. Do not substitute a production URL.');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = raw;
process.env.TEST_DATABASE_URL = raw;
process.env.TEST_AUTO_PROVISION_USERS = 'false';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.FILE_TOKEN_SECRET = randomBytes(32).toString('hex');

// This program imports only the actual private-media router; it never starts
// Chatforia's index.js, socket server, webhook handlers or cron jobs.
// Strip provider credentials before importing any app modules.
for (const key of Object.keys(process.env)) {
  if (/^(R2_|AWS_|TWILIO_|TELNA_|STRIPE_|OPENAI_|GOOGLE_|SENDGRID_|RESEND_)/.test(key)) {
    delete process.env[key];
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chatforia-private-media-qa-'));
process.env.UPLOADS_DIR = root;
const sessionFile = path.join(root, 'session.json');
let db;
let server;
let roomId;
const usersCreated = [];
const userByRole = {};
let cleanupStarted = false;

function wavFixture() {
  const sampleRate = 16000;
  const samples = sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 7000), i * 2);
  }
  const out = Buffer.alloc(44 + data.length);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + data.length, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(data.length, 40);
  data.copy(out, 44);
  return out;
}

async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) {
    // Never delete by a broad username prefix, drop a database, or truncate.
    if (roomId !== undefined) {
      await db.chatRoom.delete({ where: { id: roomId } }).catch(err =>
        console.warn('QA room cleanup warning:', err.message)
      );
    }
    for (const id of usersCreated) {
      await db.user.delete({ where: { id } }).catch(err =>
        console.warn('QA user cleanup warning:', err.message)
      );
    }
    await db.$disconnect();
  }
  await fs.rm(root, { recursive: true, force: true });
}

try {
  const express = (await import('express')).default;
  const jwt = (await import('jsonwebtoken')).default;
  db = (await import('../utils/prismaClient.js')).default;
  const router = (await import('../routes/privateMedia.js')).default;
  const { requireAuth } = await import('../middleware/auth.js');

  const [identity] = await db.$queryRawUnsafe(
    'SELECT current_database()::text AS name, host(inet_server_addr()) AS host, inet_server_port()::int AS port'
  );
  if (identity.name !== NAME || identity.host !== '127.0.0.1' || identity.port !== 5432) {
    throw new Error('Database identity mismatch; no fixtures created');
  }

  const suffix = randomUUID().replaceAll('-', '');
  for (const role of ['sender', 'receiver', 'outsider']) {
    const user = await db.user.create({
      data: {
        username: 'private_media_local_qa_' + role + '_' + suffix,
        passwordHash: 'QA-inert-no-login',
        isTestAccount: true,
      },
    });
    userByRole[role] = user;
    usersCreated.push(user.id);
  }

  const room = await db.chatRoom.create({
    data: { isGroup: false, ownerId: userByRole.sender.id },
  });
  roomId = room.id;
  for (const role of ['sender', 'receiver']) {
    await db.participant.create({
      data: { chatRoomId: room.id, userId: userByRole[role].id },
    });
  }
  const message = await db.message.create({
    data: {
      sender: { connect: { id: userByRole.sender.id } },
      chatRoom: { connect: { id: room.id } },
      rawContent: 'Local private-media QA fixtures',
    },
  });

  await fs.mkdir(path.join(root, 'media'));
  await fs.mkdir(path.join(root, 'thumbs'));
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+rkh0AAAAASUVORK5CYII=',
    'base64'
  );
  const fixtures = [
    { kind: 'IMAGE', mimeType: 'image/png', file: 'qa-image.png', data: pixel, thumb: 'qa-thumb.png' },
    { kind: 'AUDIO', mimeType: 'audio/wav', file: 'qa-tone.wav', data: wavFixture() },
    { kind: 'FILE', mimeType: 'text/plain', file: 'qa-file.txt', data: Buffer.from('DISPOSABLE QA FILE') },
  ];
  const ids = {};
  for (const fixture of fixtures) {
    await fs.writeFile(path.join(root, 'media', fixture.file), fixture.data);
    if (fixture.thumb) {
      await fs.writeFile(path.join(root, 'thumbs', fixture.thumb), fixture.data);
    }
    const row = await db.messageAttachment.create({
      data: {
        messageId: message.id,
        kind: fixture.kind,
        url: 'media/' + fixture.file,
        thumbUrl: fixture.thumb ? 'thumbs/' + fixture.thumb : null,
        mimeType: fixture.mimeType,
      },
    });
    ids[fixture.kind.toLowerCase()] = row.id;
  }

  const sessions = Object.fromEntries(
    Object.entries(userByRole).map(([role, user]) => [
      role,
      jwt.sign(
        { id: user.id, typ: 'session', tokenVersion: 0 },
        process.env.JWT_SECRET,
        { expiresIn: '2h', algorithm: 'HS256' }
      ),
    ])
  );
  await fs.writeFile(sessionFile, JSON.stringify({ token: sessions, attachmentId: ids }, null, 2), {
    mode: 0o600, flag: 'wx',
  });

  const app = express();
  app.disable('x-powered-by');
  app.use('/private-media', router);
  app.get('/qa/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, purpose: 'isolated-private-media-qa', local: true });
  });
  app.get('/qa/fixtures', requireAuth, (req, res) => {
    if (req.user.id !== userByRole.sender.id && req.user.id !== userByRole.receiver.id) {
      return res.sendStatus(403);
    }
    res.set('Cache-Control', 'no-store');
    res.json({ attachments: ids });
  });

  server = await new Promise((resolve, reject) => {
    const listener = app.listen(5502, '127.0.0.1');
    listener.once('listening', () => resolve(listener));
    listener.once('error', reject);
  });

  console.log('\nLocal-only QA API READY at http://127.0.0.1:5502');
  console.log('Android emulator uses http://10.0.2.2:5502');
  console.log('GET /qa/health checks connectivity without authentication.');
  console.log('QA session file (temporary, private; do not share contents): ' + sessionFile);
  console.log('Test attachments: ' + JSON.stringify(ids));
  console.log('Press Ctrl+C to stop, revoke the ephemeral tokens and remove fixtures.');

  await new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} catch (err) {
  process.exitCode = 1;
  console.error('Local private-media QA failed:', err?.message || err);
} finally {
  await cleanup();
  console.log('Local private-media QA shut down and cleaned up.');
}
