import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = path.dirname(fileURLToPath(import.meta.url));
const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
  .sort().reverse().map((name) => path.join(cache, name,
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Disposable Chromium unavailable');

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.locator('input[autocomplete="username"]').waitFor({ timeout: 15000 });
  await page.locator('input[autocomplete="username"]').fill('dev_user_1@example.com');
  await page.locator('input[autocomplete="current-password"]')
    .fill(fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim());
  const login = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/auth/login' && response.status() === 200, { timeout: 20000 });
  await page.locator('button[type="submit"]').click();
  await login;
  const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
  await unlock.waitFor({ timeout: 60000 });
  await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true })
    .fill(fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim());
  await unlock.click();
  await unlock.waitFor({ state: 'hidden', timeout: 30000 });

  let transformed = false;
  await page.route('**/sms/threads/1/read', (route) => route.fulfill({ status: 200, body: '{}' }));
  await page.route('**/sms/threads/1', async (route) => {
    const response = await route.fetch();
    const thread = await response.json();
    if (!response.ok() || !Array.isArray(thread.messages)) throw new Error('Disposable SMS thread unavailable');
    const media = thread.messages.find((message) =>
      Array.isArray(message.mediaUrls) && message.mediaUrls.length && String(message.body || '').trim());
    const text = thread.messages.find((message) =>
      (!Array.isArray(message.mediaUrls) || !message.mediaUrls.length) && String(message.body || '').trim());
    if (!media || !text) throw new Error('Captioned media and text fixtures required');
    media.direction = 'out';
    text.direction = 'out';
    transformed = true;
    await route.fulfill({ response, body: JSON.stringify(thread) });
  });
  await page.goto('http://localhost:5173/sms/1', { waitUntil: 'domcontentloaded' });
  const media = page.locator('.sms-message-row[data-outgoing="true"] .sms-bubble[data-has-media="true"]').first();
  const text = page.locator('.sms-message-row[data-outgoing="true"] .sms-bubble:not([data-has-media])').first();
  await media.waitFor({ timeout: 15000 });
  await text.waitFor({ timeout: 15000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'velvet'; });
  await page.waitForTimeout(200);
  await media.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'after-390-light-sms.png'), animations: 'disabled' });
  const result = await page.evaluate(() => {
    const media = document.querySelector('.sms-message-row[data-outgoing="true"] .sms-bubble[data-has-media="true"]');
    const text = document.querySelector('.sms-message-row[data-outgoing="true"] .sms-bubble:not([data-has-media])');
    const caption = media.querySelector('.mantine-Text-root');
    return { theme: document.documentElement.dataset.theme,
      bubbleColor: getComputedStyle(text).color,
      bubbleGradient: getComputedStyle(text).backgroundImage,
      mediaBackground: getComputedStyle(media).backgroundColor,
      mediaColor: getComputedStyle(media).color,
      captionColor: caption ? getComputedStyle(caption).color : null,
      captionOpacity: caption ? Number(getComputedStyle(caption).opacity) : null };
  });
  if (!transformed || result.theme !== 'velvet' || result.bubbleColor !== 'rgb(36, 16, 49)' ||
      !result.bubbleGradient.includes('255, 45, 122') ||
      result.captionColor !== 'rgb(255, 255, 255)') {
    throw new Error(`Velvet SMS text/caption mismatch: ${JSON.stringify(result)}`);
  }
  fs.writeFileSync(path.join(output, 'sms-report.json'), JSON.stringify({
    environment: 'Disposable authenticated browser; direction changed only in intercepted response',
    databaseWrites: false, carrierSend: false, ...result,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ outgoingSmsText: result.bubbleColor, outgoingMmsCaption: result.captionColor }));
  await context.close();
} finally { await browser.close(); }
