import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/node_modules/playwright/index.mjs';

const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const checkpoint = '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124';
const require = createRequire(path.join(checkpoint, 'package.json'));
require('dotenv').config({ path: path.join(qaRoot, 'server.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const database = new URL(process.env.DATABASE_URL || '');
if (process.env.NODE_ENV !== 'development' || database.hostname !== '127.0.0.1' ||
    database.port !== '55432' || database.pathname !== '/chatforia_web_qa_dev') {
  throw new Error('Refusing a non-disposable database');
}
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'final-release-authenticated-20261125.json');
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((entry) => /^chromium-\d+$/.test(entry))
  .sort().reverse().map((entry) => path.join(cache, entry,
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Local Chromium unavailable');

const db = new PrismaClient();
const result = {
  environment: 'Disposable localhost database and accounts only; no production storage, carrier, or provider calls',
  checkedAt: new Date().toISOString(),
  offline: {}, media: {},
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const api = 'http://127.0.0.1:5002';
const frontend = 'http://localhost:5173';
const password = fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim();
const auth = (token) => ({ Authorization: `Bearer ${token}` });
let browser;
let activePage;
let editedId;
let deletedId;
let removedParticipant;

async function login(n) {
  const response = await fetch(`${api}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: frontend },
    body: JSON.stringify({ identifier: `dev_user_${n}@example.com`, password }),
  });
  const body = await response.json();
  assert(response.status === 200 && typeof body.token === 'string', `Disposable login ${n} failed`);
  return body.token;
}

async function authenticatePage(page) {
  await page.goto(`${frontend}/chat/1`, { waitUntil: 'domcontentloaded' });
  const email = page.locator('input[autocomplete="username"]');
  if (await email.isVisible({ timeout: 5000 }).catch(() => false)) {
    await email.fill('dev_user_1@example.com');
    await page.locator('input[autocomplete="current-password"]').fill(password);
    const signedIn = page.waitForResponse((response) =>
      response.url().endsWith('/auth/me') && response.status() === 200);
    await page.locator('button[type="submit"]').click();
    await signedIn;
  }
  await page.goto(`${frontend}/chat/1`, { waitUntil: 'domcontentloaded' });
  const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
  if (await unlock.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true })
      .fill(fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim());
    await unlock.click();
  }
}

try {
  const [identity] = await db.$queryRaw`SELECT current_database()::text AS name, inet_server_port()::int AS port`;
  assert(identity?.name === 'chatforia_web_qa_dev' && identity?.port === 55432,
    'Disposable database identity mismatch');
  const users = await db.user.findMany({
    where: { username: { in: ['dev_user_1', 'dev_user_2', 'dev_user_3'] } },
    select: { id: true, username: true },
  });
  const owner = users.find((user) => user.username === 'dev_user_1');
  const peer = users.find((user) => user.username === 'dev_user_2');
  const outsider = users.find((user) => user.username === 'dev_user_3');
  assert(owner && peer && outsider, 'Disposable users missing');
  const room = await db.chatRoom.findUnique({ where: { id: 1 },
    select: { participants: { select: { userId: true } } } });
  assert(room?.participants?.some((p) => p.userId === owner.id) &&
    room.participants.some((p) => p.userId === peer.id) &&
    !room.participants.some((p) => p.userId === outsider.id), 'Disposable room membership mismatch');

  const stamp = `${Date.now()}-${process.pid}`;
  const beforeEdit = `QA-offline-edit-before-${stamp}`;
  const afterEdit = `QA-offline-edit-after-${stamp}`;
  const beforeDelete = `QA-offline-delete-before-${stamp}`;
  const edited = await db.message.create({ data: { chatRoomId: 1, senderId: peer.id,
    clientMessageId: `qa-offline-edit-${stamp}`, rawContent: beforeEdit } });
  editedId = edited.id;
  const deleted = await db.message.create({ data: { chatRoomId: 1, senderId: peer.id,
    clientMessageId: `qa-offline-delete-${stamp}`, rawContent: beforeDelete } });
  deletedId = deleted.id;

  browser = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
    executablePath, headless: true, viewport: { width: 1280, height: 800 },
  });
  const context = browser;
  const page = await context.newPage();
  activePage = page;
  let authoritativeRefreshes = 0;
  const conversationResponses = [];
  page.on('response', (response) => {
    const responsePath = new URL(response.url()).pathname;
    if (responsePath === '/messages/1' && response.status() === 200) authoritativeRefreshes++;
    if (responsePath === '/messages/1' || responsePath === '/chatrooms/1') {
      conversationResponses.push({ path: responsePath, status: response.status() });
    }
  });
  await authenticatePage(page);
  const messageRows = page.locator('.message-row');
  await messageRows.filter({ hasText: beforeEdit }).first().waitFor({ timeout: 15000 });
  await messageRows.filter({ hasText: beforeDelete }).first().waitFor({ timeout: 15000 });
  await page.getByText('Chats', { exact: true }).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(750);
  const requestsBefore = authoritativeRefreshes;
  await context.setOffline(true);
  assert(await page.evaluate(() => !navigator.onLine), 'Browser did not enter offline mode');
  await db.message.update({ where: { id: editedId }, data: {
    rawContent: afterEdit, editedAt: new Date(), revision: { increment: 1 },
  } });
  await db.message.update({ where: { id: deletedId }, data: {
    rawContent: null, deletedForAll: true, deletedAt: new Date(), revision: { increment: 1 },
  } });
  assert(await messageRows.filter({ hasText: beforeEdit }).first().isVisible() &&
    await messageRows.filter({ hasText: beforeDelete }).first().isVisible(),
  'Offline view did not retain previously confirmed messages');
  await context.setOffline(false);
  await messageRows.filter({ hasText: afterEdit }).first().waitFor({ timeout: 15000 });
  await messageRows.filter({ hasText: beforeDelete }).first().waitFor({ state: 'detached', timeout: 15000 });
  assert(await messageRows.filter({ hasText: beforeEdit }).count() === 0 &&
    await messageRows.filter({ hasText: beforeDelete }).count() === 0,
  'Stale edited/deleted message remained after online refresh');
  assert(authoritativeRefreshes > requestsBefore, 'Online recovery did not fetch authoritative messages');
  result.offline = { pass: true, existingMessagesVisibleOffline: true,
    missedEditReconciled: true, missedDeleteReconciled: true,
    authoritativeRefreshObserved: true, browserOfflineModeObserved: true,
    conversationResponses };
  await browser.close();
  browser = null;

  const [ownerToken, peerToken, outsiderToken] = await Promise.all([login(1), login(2), login(3)]);
  const fixture = await db.message.findFirst({
    where: { chatRoomId: 1, clientMessageId: 'webqa-media-portrait-image-only-20261124' },
    select: { attachments: { select: { id: true }, take: 1 } },
  });
  const attachmentId = fixture?.attachments?.[0]?.id;
  assert(attachmentId, 'Existing disposable private-media fixture missing');
  const grantPath = `/private-media/message/${attachmentId}`;
  const granted = await fetch(api + grantPath, { headers: auth(ownerToken) });
  assert(granted.status === 200, 'Owner private-media grant unavailable before revocation');
  const grant = await granted.json();
  const grantedFile = await fetch(new URL(grant.url, api));
  assert(grantedFile.status === 200, 'Owner private-media file unavailable before revocation');
  await grantedFile.arrayBuffer();
  const outsiderGrant = await fetch(api + grantPath, { headers: auth(outsiderToken) });
  assert(outsiderGrant.status === 404, 'Other-account private-media grant was not denied');
  const sms = await db.smsMessage.findFirst({
    where: { threadId: 1, providerMessageId: 'webqa-mms-portrait-image-only-20261124' },
    select: { id: true },
  });
  assert(sms?.id, 'Existing disposable MMS fixture missing');
  const smsOwner = await fetch(`${api}/sms/media/${sms.id}/0`, { headers: auth(ownerToken) });
  const smsPeer = await fetch(`${api}/sms/media/${sms.id}/0`, { headers: auth(peerToken) });
  assert(smsOwner.status === 200 && smsPeer.status === 404,
    'SMS media owner/other-account authorization mismatch');
  await smsOwner.arrayBuffer();

  removedParticipant = await db.participant.findUnique({
    where: { chatRoomId_userId: { chatRoomId: 1, userId: owner.id } },
  });
  assert(removedParticipant, 'Disposable owner membership missing');
  await db.participant.delete({ where: { id: removedParticipant.id } });
  const revokedGrant = await fetch(api + grantPath, { headers: auth(ownerToken) });
  const revokedExistingFile = await fetch(new URL(grant.url, api));
  assert(revokedGrant.status === 404 && revokedExistingFile.status === 404,
    'Revoked membership did not deny new and previously issued media access');
  result.media = { pass: true, ownerGrantBefore: granted.status, ownerFileBefore: grantedFile.status,
    nativeOtherAccountDenied: outsiderGrant.status, smsOwner: smsOwner.status,
    smsOtherAccountDenied: smsPeer.status, revokedNewGrant: revokedGrant.status,
    revokedIssuedFile: revokedExistingFile.status };
} catch (error) {
  result.error = error.message;
  if (activePage && !activePage.isClosed()) {
    result.browserDiagnostic = { urlPath: new URL(activePage.url()).pathname,
      bodyTail: (await activePage.locator('body').innerText().catch(() => '')).slice(-800) };
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (removedParticipant) {
    const exists = await db.participant.findUnique({ where: { id: removedParticipant.id } }).catch(() => null);
    if (!exists) await db.participant.create({ data: removedParticipant }).catch((error) => {
      result.restorationError = `Participant restore failed: ${error.message}`;
      process.exitCode = 1;
    });
  }
  for (const id of [editedId, deletedId].filter(Boolean)) {
    await db.message.delete({ where: { id } }).catch((error) => {
      result.restorationError = `Temporary message cleanup failed: ${error.message}`;
      process.exitCode = 1;
    });
  }
  await db.$disconnect();
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
