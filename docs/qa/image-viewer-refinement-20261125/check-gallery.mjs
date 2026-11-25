import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/node_modules/playwright/index.mjs';

const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const output = '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/docs/qa/image-viewer-refinement-20261125';
const reportPath = path.join(output, 'report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((entry) => /^chromium-\d+$/.test(entry)).sort().reverse()
  .map((entry) => path.join(cache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
const context = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
  executablePath, headless: true, viewport: { width: 1440, height: 900 },
});
const page = context.pages()[0] || await context.newPage();

async function authenticate() {
  await page.goto('http://localhost:5173/chat/1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  if (await page.locator('input[autocomplete="username"]').isVisible()) {
    const password = fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim();
    await page.locator('input[autocomplete="username"]').fill('dev_user_1@example.com');
    await page.locator('input[autocomplete="current-password"]').fill(password);
    const loggedIn = page.waitForResponse((response) =>
      response.url().endsWith('/auth/me') && response.status() === 200, { timeout: 20000 });
    await page.locator('button[type="submit"]').click();
    await loggedIn;
  }
}
async function unlockIfNeeded() {
  const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
  if (await unlock.isVisible({ timeout: 3000 }).catch(() => false)) {
    const passcode = fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim();
    await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true }).fill(passcode);
    await unlock.click();
  }
}

try {
  await authenticate();
  report.gallery = [];
  for (const [width, height] of [[1440, 900], [375, 667]]) {
    await page.setViewportSize({ width, height });
    for (const channel of ['native', 'mms']) {
      await page.goto(channel === 'native'
        ? 'http://localhost:5173/chat/1'
        : 'http://localhost:5173/sms/1', { waitUntil: 'domcontentloaded' });
      await unlockIfNeeded();
      const icon = page.getByRole('button', { name: channel === 'native' ? 'Open media gallery' : 'Media', exact: true });
      await icon.click();
      const gallery = page.getByRole('dialog', {
        name: channel === 'native' ? 'Shared media' : /Media —/,
      });
      try {
        await gallery.waitFor({ timeout: 8000 });
      } catch (error) {
        await page.screenshot({ path: path.join(output, `debug-gallery-${width}-${channel}.png`) });
        console.error('Gallery state:', JSON.stringify(await page.evaluate(() => ({
          path: location.pathname,
          dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => ({
            label: node.getAttribute('aria-label'), text: node.innerText.slice(0, 160),
          })),
          text: document.body.innerText.slice(0, 400),
        }))));
        throw error;
      }
      const tile = gallery.getByRole('button', { name: 'Open image full size' }).first();
      await tile.waitFor({ timeout: 15000 });
      await tile.click();
      const viewer = page.getByRole('dialog', { name: 'Image viewer' });
      await viewer.waitFor();
      await viewer.locator('.shared-image-viewer-image').waitFor();
      await page.waitForTimeout(300);
      const back = viewer.getByRole('button', { name: 'Back to media' });
      if (!await back.isVisible()) throw new Error(`Missing Back control: ${channel} ${width}`);
      const geometry = await viewer.evaluate((node) => {
        const close = [...node.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Close');
        const download = [...node.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Download');
        const header = node.querySelector('.mantine-Modal-header');
        const image = node.querySelector('.shared-image-viewer-image');
        const caption = node.querySelector('.shared-image-viewer-caption');
        const backRow = node.querySelector('.shared-image-viewer-back-row');
        const rect = (element) => element ? Object.fromEntries(['top', 'bottom', 'height'].map((key) => [key, element.getBoundingClientRect()[key]])) : null;
        return { viewportHeight: innerHeight, dialog: rect(node), header: rect(header), close: rect(close),
          backRow: rect(backRow), image: rect(image), caption: rect(caption), download: rect(download),
          closeInHeader: Boolean(header?.contains(close)) };
      });
      const controlsFit = geometry.closeInHeader && geometry.header.top >= 0 &&
        geometry.download.bottom <= geometry.viewportHeight && geometry.download.top >= 0 &&
        (!geometry.caption || geometry.caption.bottom <= geometry.viewportHeight);
      if (!controlsFit) throw new Error(`Gallery viewer controls overflow: ${channel} ${width}: ${JSON.stringify(geometry)}`);
      const screenshot = `${width}-${channel}-gallery-viewer.png`;
      await page.screenshot({ path: path.join(output, screenshot) });
      await back.click();
      await gallery.waitFor({ state: 'visible' });
      await page.waitForTimeout(350);
      const tileFocused = await tile.evaluate((element) => document.activeElement === element);
      await page.keyboard.press('Escape');
      await gallery.waitFor({ state: 'hidden' });
      const conversationRestored = await page.locator('button[aria-label="Open image full size"]').count() >= 6;
      report.gallery.push({ channel, width, height, screenshot, backVisible: true, controlsFit, geometry,
        tileFocused, conversationRestored });
    }
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.gallery, null, 2));
} finally {
  await context.close();
}
