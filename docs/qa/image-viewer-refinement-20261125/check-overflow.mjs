import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/node_modules/playwright/index.mjs';

const output = path.dirname(new URL(import.meta.url).pathname);
const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((entry) => /^chromium-\d+$/.test(entry)).sort().reverse()
  .map((entry) => path.join(cache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
const context = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
  executablePath, headless: true, viewport: { width: 375, height: 500 },
});
const page = context.pages()[0] || await context.newPage();
try {
  await page.goto('http://localhost:5173/chat/1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  if (await page.locator('input[autocomplete="username"]').isVisible()) {
    await page.locator('input[autocomplete="username"]').fill('dev_user_1@example.com');
    await page.locator('input[autocomplete="current-password"]').fill(fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim());
    const loggedIn = page.waitForResponse((response) => response.url().endsWith('/auth/me') && response.status() === 200);
    await page.locator('button[type="submit"]').click();
    await loggedIn;
    await page.goto('http://localhost:5173/chat/1', { waitUntil: 'domcontentloaded' });
  }
  const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
  if (await unlock.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true })
      .fill(fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim());
    await unlock.click();
  }
  const buttons = page.getByRole('button', { name: 'Open image full size' });
  await buttons.first().waitFor();
  const portrait = [];
  for (let i = 0, count = await buttons.count(); i < count; i++) {
    const image = buttons.nth(i).locator('img');
    if (await image.evaluate((node) => node.naturalWidth === 640 && node.naturalHeight === 960)) portrait.push(buttons.nth(i));
  }
  if (portrait.length < 2) throw new Error('Captioned portrait fixture unavailable');
  await portrait[1].click();
  const dialog = page.getByRole('dialog', { name: 'Image viewer' });
  await dialog.locator('.shared-image-viewer-image').waitFor();
  const overflow = await dialog.evaluate((node) => {
    const body = node.querySelector('.shared-image-viewer-body');
    const caption = node.querySelector('.shared-image-viewer-caption');
    caption.textContent = `${caption.textContent} `.repeat(30);
    const scrollable = body.scrollHeight > body.clientHeight && getComputedStyle(body).overflowY === 'auto';
    body.scrollTop = body.scrollHeight;
    const download = [...node.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Download');
    return { viewport: [innerWidth, innerHeight], scrollable, scrollTop: body.scrollTop,
      downloadBottom: download.getBoundingClientRect().bottom,
      downloadVisibleAfterScroll: download.getBoundingClientRect().bottom <= innerHeight };
  });
  if (!overflow.scrollable || !overflow.downloadVisibleAfterScroll) throw new Error(`Overflow fallback failed: ${JSON.stringify(overflow)}`);
  await page.screenshot({ path: path.join(output, '375-short-long-caption-scroll.png') });
  const reportPath = path.join(output, 'report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  report.overflowFallback = overflow;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(overflow));
} finally {
  await context.close();
}
