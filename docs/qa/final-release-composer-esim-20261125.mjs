import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/node_modules/playwright/index.mjs';

const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'final-release-composer-esim-20261125.json');
const frontend = 'http://localhost:5173';
const api = 'http://127.0.0.1:5002';
const password = fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim();
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((entry) => /^chromium-\d+$/.test(entry))
  .sort().reverse().map((entry) => path.join(cache, entry,
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Local Chromium unavailable');
const assert = (value, message) => { if (!value) throw new Error(message); };
const esimOnly = process.argv.includes('--esim-only');
const result = { checkedAt: new Date().toISOString(),
  environment: 'Disposable localhost account and upload fixture; SMS send intercepted; owned-package browser responses marked synthetic',
  composer: esimOnly && fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')).composer : {},
  esim: {} };
let context;
let page;

async function ensureSignedIn() {
  await page.goto(`${frontend}/sms/compose?to=%2B15555559991`, { waitUntil: 'domcontentloaded' });
  const email = page.locator('input[autocomplete="username"]');
  if (await email.isVisible({ timeout: 5000 }).catch(() => false)) {
    await email.fill('dev_user_1@example.com');
    await page.locator('input[autocomplete="current-password"]').fill(password);
    const signedIn = page.waitForResponse((response) =>
      response.url().endsWith('/auth/me') && response.status() === 200);
    await page.locator('button[type="submit"]').click();
    await signedIn;
  }
  await page.goto(`${frontend}/sms/compose?to=%2B15555559991`, { waitUntil: 'domcontentloaded' });
  const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
  if (await unlock.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true })
      .fill(fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim());
    await unlock.click();
  }
}

try {
  const authResponse = await fetch(api + '/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: frontend },
    body: JSON.stringify({ identifier: 'dev_user_1@example.com', password }) });
  const authBody = await authResponse.json();
  assert(authResponse.status === 200 && authBody.token, 'Disposable login failed');
  const statusResponse = await fetch(api + '/api/wireless/status', {
    headers: { Authorization: `Bearer ${authBody.token}` },
  });
  const actualWireless = await statusResponse.json();
  assert(statusResponse.status === 200, 'Disposable wireless status request failed');
  result.esim.actualDisposableStatus = { http: statusResponse.status,
    mode: actualWireless.mode, state: actualWireless.state };

  context = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
    executablePath, headless: true, viewport: { width: 390, height: 844 },
  });
  page = await context.newPage();
  if (!esimOnly) {
  const uploadStatuses = [];
  const sent = [];
  let sendStatus = 503;
  page.on('response', (response) => {
    const parsed = new URL(response.url());
    if (parsed.pathname === '/uploads/intent' || parsed.pathname === '/uploads/complete' ||
        (response.request().method() === 'PUT' && parsed.port === '5004')) {
      uploadStatuses.push({ path: parsed.pathname, status: response.status() });
    }
  });
  await page.route('**/sms/threads/lookup**', (route) => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ threadId: null }) }));
  await page.route('**/sms/send', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: sendStatus, contentType: 'application/json',
      body: JSON.stringify(sendStatus === 202 ? { threadId: 900001 } : { code: 'SIMULATED_FAILURE' }) });
  });
  await ensureSignedIn();
  const composer = page.locator('.responsive-message-composer');
  await composer.waitFor({ timeout: 15000 });
  const fileInput = composer.locator('input[type="file"]').first();
  const preview = page.locator('img[alt="Selected attachment"]');
  await fileInput.setInputFiles(path.join(qaRoot, 'fixtures/portrait.png'));
  await preview.waitFor({ timeout: 15000 });
  const previewDetails = await preview.evaluate((image) => ({
    blob: image.src.startsWith('blob:'), naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }));
  assert(previewDetails.blob && previewDetails.naturalWidth > 0 &&
    previewDetails.naturalHeight > previewDetails.naturalWidth, 'Attachment preview failed');
  await page.getByRole('button', { name: 'Remove selected attachment' }).click();
  await preview.waitFor({ state: 'detached' });
  await fileInput.setInputFiles(path.join(qaRoot, 'fixtures/portrait.png'));
  await preview.waitFor({ timeout: 15000 });
  const caption = 'Disposable QA caption for simulated MMS';
  await composer.getByRole('textbox', { name: 'Message composer' }).fill(caption);
  await composer.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('alert').first().waitFor({ timeout: 12000 });
  const draftRetained = await preview.isVisible() &&
    await composer.getByRole('textbox', { name: 'Message composer' }).inputValue() === caption;
  assert(draftRetained, 'Failed send lost caption or attachment');
  sendStatus = 202;
  await composer.getByRole('button', { name: 'Send' }).click();
  await page.waitForURL('**/sms/900001', { timeout: 12000 });
  const sentPrivateKeys = sent.length === 2 && sent.every((item) =>
    item.to === '+15555559991' && item.body === caption &&
    Array.isArray(item.mediaUrls) && item.mediaUrls.length === 1 &&
    /^uploads\/u\d+\//.test(item.mediaUrls[0]) && !item.mediaUrls[0].startsWith('http'));
  assert(sentPrivateKeys && uploadStatuses.some((entry) => entry.path === '/uploads/intent' && entry.status === 200) &&
    uploadStatuses.some((entry) => entry.path === '/uploads/complete' && entry.status === 200) &&
    uploadStatuses.some((entry) => entry.status === 200 && entry.path.startsWith('/uploads/')),
  'Upload or simulated MMS contract failed');
  result.composer = { pass: true, preview: previewDetails, removalWorked: true,
    failedSendRetainedDraft: true, simulatedRetryNavigated: true,
    carrierRequestsIntercepted: sent.length, privateUploadKeyOnly: true, uploadStatuses };

  await page.unroute('**/sms/threads/lookup**');
  }
  await page.goto(`${frontend}/upgrade`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'App plans' }).waitFor({ timeout: 15000 });
  const appDefault = await page.getByRole('heading', { name: 'App plans' }).isVisible();
  assert(appDefault, 'Ordinary Pricing did not default to App plans');

  await page.goto(`${frontend}/wireless`, { waitUntil: 'domcontentloaded' });
  const noPackPlanButton = page.getByRole('button', { name: /View plans|Set up eSIM first/ }).first();
  await noPackPlanButton.waitFor({ timeout: 15000 });
  await noPackPlanButton.click();
  await page.waitForURL('**/upgrade?section=mobile', { timeout: 12000 });
  await page.getByText('Choose a data pack').waitFor({ timeout: 15000 });
  const noPackNavigation = page.url().endsWith('/upgrade?section=mobile');

  const syntheticOwned = {
    mode: 'INDIVIDUAL', state: 'LOW', low: true, exhausted: false, expired: false,
    source: { type: 'ESIM_PACK', id: -1, addonKind: 'chatforia_esim_local_3_premium',
      totalDataMb: 3072, remainingDataMb: 150, daysRemaining: 5 },
    queuedPacks: [{ id: -2, addonKind: 'chatforia_esim_europe_5_premium',
      totalDataMb: 5120, remainingDataMb: 5120 }],
  };
  await page.route('**/api/wireless/status', (route) => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify(syntheticOwned) }));
  await page.goto(`${frontend}/wireless`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Local 3 GB').waitFor({ timeout: 12000 });
  await page.getByText(/Queued data packs/).waitFor({ timeout: 12000 });
  await page.getByText('Your data is running low.').waitFor({ timeout: 12000 });
  await page.getByRole('button', { name: 'Top up now' }).click();
  await page.waitForURL('**/upgrade?section=mobile', { timeout: 12000 });
  await page.getByText('Choose a data pack').waitFor({ timeout: 12000 });
  result.esim = { ...result.esim, pass: true, ordinaryPricingAppDefault: appDefault,
    noPackViewPlansMobile: noPackNavigation, syntheticOwnedState: 'LOW',
    syntheticOwnedPackAndQueueVisible: true, syntheticTopUpOpenedMobilePackages: true,
    purchaseRequestsMade: 0, ownedPackageSource: 'Browser-only contract fixture; disposable API returned NONE' };
} catch (error) {
  result.error = error.message;
  result.browserDiagnostic = page && !page.isClosed() ? {
    urlPath: new URL(page.url()).pathname,
    bodyTail: (await page.locator('body').innerText().catch(() => '')).slice(-650),
  } : null;
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
