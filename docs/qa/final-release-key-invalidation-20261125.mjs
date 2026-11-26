import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/node_modules/playwright/index.mjs';

const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const frontend = 'http://localhost:5173';
const report = {
  environment: 'Disposable localhost account and browser only; server key and recovery backup unchanged',
  checkedAt: new Date().toISOString(),
  lockedKey: {},
  replacedKeyResponse: {},
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((entry) => /^chromium-\d+$/.test(entry))
  .sort().reverse().map((entry) => path.join(cache, entry,
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
assert(executablePath, 'Local Chromium unavailable');
let browser;
try {
  browser = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
    executablePath, headless: true, viewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  let attemptedMessagePosts = 0;
  await page.route('**/messages', async (route) => {
    if (route.request().method() === 'POST') {
      attemptedMessagePosts++;
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'Disposable QA intercepted send' }) });
    } else await route.continue();
  });
  async function openAccount() {
    await page.goto(frontend + '/chat/1', { waitUntil: 'domcontentloaded' });
    const email = page.locator('input[autocomplete="username"]');
    if (await email.isVisible({ timeout: 5000 }).catch(() => false)) {
      await email.fill('dev_user_1@example.com');
      await page.locator('input[autocomplete="current-password"]')
        .fill(fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim());
      await page.locator('button[type="submit"]').click();
    }
    const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
    if (await unlock.isVisible({ timeout: 2500 }).catch(() => false)) {
      await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true })
        .fill(fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim());
      await unlock.click();
    }
    await page.getByRole('textbox', { name: 'Message composer' }).waitFor({ timeout: 15000 });
  }
  await openAccount();
  await page.locator('.message-row').first().waitFor({ timeout: 15000 });
  const messagesBefore = await page.locator('.message-row').count();
  assert(messagesBefore > 0, 'No previously loaded native messages');
  const keyProtected = await page.evaluate(async () =>
    Boolean((await import('/src/utils/encryptionClient.js')).getLocalKeyBundleMeta &&
      (await (await import('/src/utils/encryptionClient.js')).getLocalKeyBundleMeta())?.hasEncrypted));
  assert(keyProtected, 'Disposable browser key bundle is not passcode protected');

  await page.getByRole('textbox', { name: 'Message composer' }).fill('QA locked-key unsent draft');
  await page.getByRole('button', { name: 'Open image full size' }).first().click();
  const viewer = page.getByRole('dialog', { name: 'Image viewer' });
  await viewer.waitFor({ timeout: 15000 });
  const image = page.getByRole('img', { name: 'Chatforia image' });
  await image.waitFor({ timeout: 15000 });
  const blobUrl = await image.getAttribute('src');
  assert(blobUrl?.startsWith('blob:'), 'Native image viewer did not hold a local Blob URL');
  await page.evaluate(async () => (await import('/src/utils/encryptionClient.js')).lockKeyBundle());
  await page.locator('button[aria-label="Send"]').first().evaluate((element) => element.click());
  await page.getByText('Secure messages locked').waitFor({ timeout: 15000 });
  assert(await page.locator('.message-row').count() === 0, 'Cached message rows remain visible after lock gate');
  assert(await viewer.count() === 0, 'Decrypted media viewer remains open after lock gate');
  const blobRevoked = await page.evaluate(async (url) => {
    try { await fetch(url); return false; } catch { return true; }
  }, blobUrl);
  assert(blobRevoked, 'Former media Blob URL remains fetchable after lock gate');
  assert(attemptedMessagePosts === 0, 'Locked-key draft reached message creation');
  report.lockedKey = {
    pass: true, protectedBundle: true, messagesBefore,
    recoveryGateShown: true, cachedRowsHidden: true,
    imageViewerClosed: true, blobUrlRevoked: true,
    messagePosts: attemptedMessagePosts,
  };
  await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true })
    .fill(fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim());
  await page.getByRole('button', { name: 'Unlock secure messages' }).click();
  await page.getByRole('textbox', { name: 'Message composer' }).waitFor({ timeout: 15000 });

  const fakePublicKey = crypto.randomBytes(32).toString('base64');
  let substituted = 0;
  await page.route('**/auth/me', async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const payload = await response.json();
    const user = payload?.user ?? payload;
    assert(user?.publicKey && user.publicKey !== fakePublicKey, 'Disposable key response unusable');
    const altered = payload?.user
      ? { ...payload, user: { ...payload.user, publicKey: fakePublicKey } }
      : { ...payload, publicKey: fakePublicKey };
    substituted++;
    await route.fulfill({ response, json: altered });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Secure messages locked').waitFor({ timeout: 15000 });
  assert(await page.locator('.message-row').count() === 0, 'Old message rows visible after mismatched key response');
  assert(await page.getByRole('dialog', { name: 'Image viewer' }).count() === 0,
    'Image viewer visible after mismatched key response');
  assert(substituted > 0, 'No authenticated key response was intercepted');
  report.replacedKeyResponse = {
    pass: true, simulatedResponseOnly: true, recoveryGateShown: true,
    cachedRowsHidden: true, imageViewerAbsent: true,
    authResponseIntercepted: true,
  };
  await page.unroute('**/auth/me');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const postUnlock = page.getByRole('button', { name: 'Unlock secure messages' });
  if (await postUnlock.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true })
      .fill(fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim());
    await postUnlock.click();
  }
  await page.getByRole('textbox', { name: 'Message composer' }).waitFor({ timeout: 15000 });
  report.originalKeyStillUsable = true;
  await page.close();
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(JSON.stringify({ ...report, error: String(error?.message || error).slice(0, 500) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
