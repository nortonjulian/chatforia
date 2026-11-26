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
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'final-release-owned-esim-20261125.json');
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((entry) => /^chromium-\d+$/.test(entry))
  .sort().reverse().map((entry) => path.join(cache, entry,
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Local Chromium unavailable');

const db = new PrismaClient();
const api = 'http://127.0.0.1:5002';
const frontend = 'http://localhost:5173';
const password = fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim();
const assert = (value, message) => { if (!value) throw new Error(message); };
const result = { checkedAt: new Date().toISOString(),
  environment: 'Disposable local mock purchase only; mock- provider ID bypasses Telna; no real payment or replacement',
  api: {}, browser: {} };
let context;
let purchaseId;

async function requestJson(pathname, token) {
  const response = await fetch(api + pathname, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}

try {
  const [identity] = await db.$queryRaw`SELECT current_database()::text AS name, inet_server_port()::int AS port`;
  assert(identity?.name === 'chatforia_web_qa_dev' && identity?.port === 55432,
    'Disposable database identity mismatch');
  const owner = await db.user.findUnique({ where: { username: 'dev_user_1' }, select: { id: true } });
  assert(owner, 'Disposable owner missing');
  const priorPurchases = await db.mobileDataPackPurchase.count({ where: { userId: owner.id } });
  assert(priorPurchases === 0, 'Refusing to modify an account with existing purchases');
  const stamp = `${Date.now()}-${process.pid}`;
  const fixture = await db.mobileDataPackPurchase.create({ data: {
    userId: owner.id, kind: 'ESIM', addonKind: 'chatforia_esim_local_3_premium',
    totalDataMb: 3072, remainingDataMb: 150,
    expiresAt: new Date(Date.now() + 5 * 86400_000),
    billingTransactionId: `mock-qa-transaction-${stamp}`,
    providerPurchaseId: `mock-qa-package-${stamp}`,
    iccid: `mock-qa-iccid-${stamp}`,
  } });
  purchaseId = fixture.id;

  const login = await fetch(api + '/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: frontend },
    body: JSON.stringify({ identifier: 'dev_user_1@example.com', password }) });
  const loginBody = await login.json();
  assert(login.status === 200 && loginBody.token, 'Disposable login failed');
  const token = loginBody.token;
  const low = await requestJson('/api/wireless/status', token);
  const purchases = await requestJson('/api/wireless/purchases', token);
  assert(low.status === 200 && low.body.mode === 'INDIVIDUAL' && low.body.state === 'LOW' &&
    low.body.source?.id === purchaseId, 'Owned low-balance status contract failed');
  const owned = purchases.body.packages?.find((item) => item.id === purchaseId);
  assert(purchases.status === 200 && owned?.paid === true &&
    owned?.state === 'PROVIDER_UNVERIFIED' &&
    purchases.body.replacementEligibility?.eligible === false,
  'Purchased-package or safe replacement state mismatch');
  result.api.low = { http: low.status, mode: low.body.mode, state: low.body.state,
    purchaseVisible: low.body.source?.id === purchaseId };
  result.api.purchases = { http: purchases.status, mockPurchasePaid: owned.paid,
    state: owned.state, replacementEligible: purchases.body.replacementEligibility.eligible };

  context = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
    executablePath, headless: true, viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(frontend + '/wireless', { waitUntil: 'domcontentloaded' });
  await page.getByText('Local 3 GB').waitFor({ timeout: 15000 });
  await page.getByText('Your data is running low.').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Top up now' }).click();
  await page.waitForURL('**/upgrade?section=mobile', { timeout: 12000 });
  await page.getByText('Choose a data pack').waitFor({ timeout: 12000 });
  result.browser.lowPackVisible = true;
  result.browser.topUpOpenedMobilePackages = true;

  await db.mobileDataPackPurchase.update({ where: { id: purchaseId },
    data: { remainingDataMb: 0 } });
  const exhausted = await requestJson('/api/wireless/status', token);
  assert(exhausted.status === 200 && exhausted.body.state === 'EXHAUSTED' &&
    exhausted.body.source?.id === purchaseId, 'Exhausted purchased-package contract failed');
  await page.goto(frontend + '/wireless', { waitUntil: 'domcontentloaded' });
  await page.getByText(/Your data has run out/).waitFor({ timeout: 15000 });
  result.api.exhausted = { http: exhausted.status, state: exhausted.body.state,
    purchaseVisible: exhausted.body.source?.id === purchaseId };
  result.browser.exhaustedWarningVisible = true;
  result.pass = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (purchaseId) {
    await db.mobileDataPackPurchase.delete({ where: { id: purchaseId } }).catch((error) => {
      result.cleanupError = error.message;
      process.exitCode = 1;
    });
    result.mockPurchaseRemoved = !(await db.mobileDataPackPurchase.findUnique({
      where: { id: purchaseId }, select: { id: true },
    }));
    if (!result.mockPurchaseRemoved) process.exitCode = 1;
  }
  await db.$disconnect();
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
