import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = path.dirname(fileURLToPath(import.meta.url));
const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache)
  .filter((entry) => /^chromium-\d+$/.test(entry)).sort().reverse()
  .map((entry) => path.join(cache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Local Chromium unavailable');

const context = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
  executablePath, headless: true, viewport: { width: 390, height: 780 },
});
const page = context.pages()[0] || await context.newPage();
page.on('pageerror', (error) => console.error('Browser error:', error.message));
const result = { environment: 'Disposable localhost account; all upload and carrier-send requests intercepted', layoutCases: [], cases: [] };
let sendStatus = 503;
const sent = [];
const uploadCalls = [];
await page.route('**/numbers/my', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ number: '+15555550000' }) }));
await page.route('**/contacts?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
  items: [{ id: 999, alias: 'QA MMS Recipient', externalPhone: '+15555559991', userId: null }],
  nextCursor: null,
}) }));
await page.route('**/sms/threads/lookup**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ threadId: null }) }));
await page.route('**/uploads/intent', (route) => { uploadCalls.push('intent'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
  uploadUrl: 'http://localhost:5173/__qa_mms_upload', key: 'uploads/u1/qa-mms.jpg',
}) }); });
await page.route('**/__qa_mms_upload', (route) => { uploadCalls.push('put'); return route.fulfill({ status: 200, body: '' }); });
await page.route('**/uploads/complete', (route) => { uploadCalls.push('complete'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
  file: { key: 'uploads/u1/qa-mms.jpg', mimeType: 'image/jpeg', size: 42000 },
}) }); });
await page.route('**/sms/send', async (route) => {
  sent.push(route.request().postDataJSON());
  await route.fulfill({ status: sendStatus, contentType: 'application/json', body: JSON.stringify(
    sendStatus === 202 ? { threadId: 900001 } : { code: 'CARRIER_UNAVAILABLE' }
  ) });
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.locator('input[autocomplete="username"], .responsive-message-composer').first().waitFor({ timeout: 12000 });
if (await page.locator('input[autocomplete="username"]').isVisible()) {
  const password = fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim();
  await page.locator('input[autocomplete="username"]').fill('dev_user_1@example.com');
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const signedIn = page.waitForResponse((response) => response.url().endsWith('/auth/me') && response.status() === 200);
  await page.locator('button[type="submit"]').click();
  await signedIn;
}

await page.goto('http://localhost:5173/people', { waitUntil: 'domcontentloaded' });
await page.getByText('QA MMS Recipient').waitFor({ timeout: 10000 });
await page.getByRole('button', { name: 'Message', exact: true }).click();
await page.waitForURL('**/sms/compose?to=**', { timeout: 10000 });
result.normalNavigation = page.url().includes('%2B15555559991');

for (const width of [360, 375, 390, 440, 488, 768, 1032, 1280]) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('http://localhost:5173/sms/compose?to=%2B15555559991', { waitUntil: 'domcontentloaded' });
  const composer = page.locator('.responsive-message-composer');
  await composer.waitFor({ timeout: 10000 });
  result.layoutCases.push(await composer.evaluate((node) => {
    const input = node.querySelector('textarea').getBoundingClientRect();
    const attachment = node.querySelector('.composer-attachment-row').getBoundingClientRect();
    const inputRow = node.querySelector('.composer-input-row').getBoundingClientRect();
    return { width: innerWidth, inputWidth: Math.round(input.width), rowSplit: attachment.y < inputRow.y,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  }));
}

for (const width of [390, 1280]) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('http://localhost:5173/sms/compose?to=%2B15555559991', { waitUntil: 'domcontentloaded' });
  const composer = page.locator('.responsive-message-composer');
  try {
    await composer.waitFor({ timeout: 12000 });
  } catch (error) {
    console.error('Composer unavailable', { width, url: page.url(), body: (await page.locator('body').innerText()).slice(0, 600) });
    throw error;
  }
  const fileInput = composer.locator('input[type="file"]').first();
  const preview = page.locator('img[alt="Selected attachment"]');
  const chooserReady = page.waitForEvent('filechooser');
  await composer.getByRole('button', { name: 'Upload' }).focus();
  await page.keyboard.press('Enter');
  const chooser = await chooserReady;
  await chooser.setFiles(path.join(qaRoot, 'fixtures/portrait.png'));
  try {
    await preview.waitFor({ timeout: 15000 });
  } catch (error) {
    console.error('Preview unavailable', { body: (await page.locator('body').innerText()).slice(-850), url: page.url(), uploadCalls });
    throw error;
  }
  const firstPreview = await preview.evaluate((image) => ({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, srcIsBlob: image.src.startsWith('blob:') }));
  await page.screenshot({ path: path.join(output, `sms-compose-preview-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Remove selected attachment' }).click();
  await preview.waitFor({ state: 'detached' });
  await fileInput.setInputFiles(path.join(qaRoot, 'fixtures/portrait.png'));
  await preview.waitFor({ timeout: 15000 });
  await composer.getByRole('textbox', { name: 'Message composer' }).fill('QA caption');
  await composer.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('alert').first().waitFor({ timeout: 10000 });
  const failureRetained = await preview.isVisible() &&
    await composer.getByRole('textbox', { name: 'Message composer' }).inputValue() === 'QA caption';
  sendStatus = 202;
  await composer.getByRole('button', { name: 'Send' }).click();
  await page.waitForURL('**/sms/900001', { timeout: 10000 });
  const payloads = sent.slice(-2);
  const validPayloads = payloads.length === 2 && payloads.every((payload) =>
    payload.to === '+15555559991' && payload.body === 'QA caption' &&
    JSON.stringify(payload.mediaUrls) === '["uploads/u1/qa-mms.jpg"]');
  result.cases.push({ width, firstPreview, removalWorked: true, failureRetained,
    validPayloads, carrierRequestsIntercepted: payloads.length, pass: firstPreview.srcIsBlob && failureRetained && validPayloads });
  sendStatus = 503;
}

fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n');
await context.close();
if (!result.normalNavigation || result.cases.some((item) => !item.pass) ||
    result.layoutCases.some((item) => item.horizontalOverflow || item.inputWidth < 150 ||
      (item.width <= 850 && !item.rowSplit))) process.exitCode = 1;
