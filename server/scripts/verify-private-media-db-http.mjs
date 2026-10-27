/**
 * Disposable real-PostgreSQL + localhost-HTTP test for the private-media route.
 * No R2, telephony, payments, cron, or real accounts.
 *
 * QA_DATABASE_URL='postgresql://juliannorton@127.0.0.1:5432/chatforia_private_media_test_20261027' \
 *   node server/scripts/verify-private-media-db-http.mjs
 */
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DB_NAME = 'chatforia_private_media_test_20261027';
const raw = process.env.QA_DATABASE_URL;
if (!raw || process.env.NODE_ENV === 'production') {
  throw new Error('QA_DATABASE_URL is required; production mode is forbidden');
}
const target = new URL(raw);
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '5432' ||
    decodeURIComponent(target.pathname) !== '/' + DB_NAME ||
    target.search || target.hash) {
  throw new Error('Refusing anything except the local disposable private-media QA database');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = raw;
process.env.TEST_DATABASE_URL = raw;
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.FILE_TOKEN_SECRET = randomBytes(32).toString('hex');
process.env.TEST_AUTO_PROVISION_USERS = 'false';
// Avoid inherited production storage credentials entirely.
for (const key of [
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_S3_ENDPOINT', 'R2_BUCKET',
  'R2_PUBLIC_BASE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
]) delete process.env[key];

const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatforia-private-media-http-'));
process.env.UPLOADS_DIR = uploadDir;
let prisma;
let listener;
let roomId;
const qaUserIDs = [];
const check = (ok, description) => {
  if (!ok) throw new Error('FAIL: ' + description);
  console.log('PASS: ' + description);
};

try {
  const express = (await import('express')).default;
  const jwt = (await import('jsonwebtoken')).default;
  prisma = (await import('../utils/prismaClient.js')).default;
  const privateMedia = (await import('../routes/privateMedia.js')).default;

  const [{ database, port }] = await prisma.$queryRawUnsafe(
    'SELECT current_database()::text AS database, inet_server_port()::int AS port'
  );
  check(database === DB_NAME && port === 5432, 'connected to exact disposable PostgreSQL database');

  const suffix = randomUUID().replaceAll('-', '');
  const user = async role => {
    const row = await prisma.user.create({
      data: {
        username: 'private_media_qa_' + role + '_' + suffix,
        passwordHash: 'QA-only-inert-password-hash',
        isTestAccount: true,
      },
    });
    qaUserIDs.push(row.id);
    return row;
  };
  const sender = await user('sender');
  const receiver = await user('receiver');
  const outsider = await user('outsider');
  const room = await prisma.chatRoom.create({
    data: { ownerId: sender.id, isGroup: false },
  });
  roomId = room.id;
  for (const member of [sender, receiver]) {
    await prisma.participant.create({
      data: { userId: member.id, chatRoomId: room.id },
    });
  }
  const message = await prisma.message.create({
    data: {
      senderId: sender.id,
      chatRoomId: room.id,
      rawContent: 'Disposable private-media authorization QA',
    },
  });
  const attachment = await prisma.messageAttachment.create({
    data: {
      messageId: message.id,
      kind: 'FILE',
      url: 'media/qa-private.txt',
      thumbUrl: 'thumbs/qa-thumb.txt',
      mimeType: 'text/plain',
    },
  });
  await fs.mkdir(path.join(uploadDir, 'media'));
  await fs.mkdir(path.join(uploadDir, 'thumbs'));
  await fs.writeFile(path.join(uploadDir, 'media', 'qa-private.txt'), 'ONLY-AUTHORIZED-QA-FILE');
  await fs.writeFile(path.join(uploadDir, 'thumbs', 'qa-thumb.txt'), 'QA-THUMBNAIL');

  const app = express();
  app.use('/private-media', privateMedia);
  listener = await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + listener.address().port;
  const auth = who => ({
    Authorization: 'Bearer ' + jwt.sign(
      { id: who.id, typ: 'session', tokenVersion: 0 },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '5m' }
    ),
  });
  const request = (uri, headers = {}) => {
    if (!uri.startsWith('/private-media/')) throw new Error('Unexpected URL path');
    return fetch(base + uri, { headers, redirect: 'manual' });
  };

  const endpoint = '/private-media/message/' + attachment.id;
  let response = await request(endpoint);
  check(response.status === 401, 'anonymous user cannot issue a media capability');

  response = await request(endpoint, auth(outsider));
  check(response.status === 404, 'nonparticipant cannot issue a capability');

  response = await request(endpoint, auth(receiver));
  check(response.status === 200, 'real database participant can issue a capability');
  const { url } = await response.json();
  check(/^\/private-media\/file\?token=/.test(url), 'issued bounded local media URL');

  response = await request(url);
  check(response.status === 200 &&
        await response.text() === 'ONLY-AUTHORIZED-QA-FILE',
        'authorized URL streams protected local content');

  response = await request(url, { Range: 'bytes=0-3' });
  check(response.status === 206 &&
        await response.text() === 'ONLY',
        'byte-range request returns correct 206 response');

  response = await request(endpoint + '?variant=thumb', auth(receiver));
  check(response.status === 200, 'thumbnail capability issued to participant');
  const thumb = (await response.json()).url;
  response = await request(thumb);
  check(response.status === 200 &&
        await response.text() === 'QA-THUMBNAIL',
        'authorized thumbnail delivered');

  await prisma.participant.delete({
    where: { chatRoomId_userId: { chatRoomId: room.id, userId: receiver.id } },
  });
  response = await request(url);
  check(response.status === 404, 'existing grant revoked by membership removal');

  await prisma.participant.create({
    data: { chatRoomId: room.id, userId: receiver.id },
  });
  await prisma.message.update({
    where: { id: message.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  response = await request(url);
  check(response.status === 404, 'expired message cannot be downloaded');

  await prisma.message.update({
    where: { id: message.id },
    data: { expiresAt: null, deletedForAll: true },
  });
  response = await request(url);
  check(response.status === 404, 'delete-for-everyone revokes existing grant');

  console.log('\nReal-DB local private-media HTTP verification: PASSED');
} finally {
  if (listener) await new Promise(resolve => listener.close(resolve));
  // Clean only our own records. Never reset or truncate any existing database.
  if (prisma) {
    if (roomId != null) {
      await prisma.chatRoom.delete({ where: { id: roomId } }).catch(err =>
        console.warn('QA cleanup room issue:', err.message)
      );
    }
    for (const id of qaUserIDs) {
      await prisma.user.delete({ where: { id } }).catch(err =>
        console.warn('QA cleanup user issue:', err.message)
      );
    }
    await prisma.$disconnect();
  }
  await fs.rm(uploadDir, { recursive: true, force: true });
}
