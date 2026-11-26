import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/node_modules/playwright/index.mjs';

const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const output = '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/docs/qa/image-viewer-refinement-20261125';
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((entry) => /^chromium-\d+$/.test(entry)).sort().reverse()
  .map((entry) => path.join(cache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
const context = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
  executablePath, headless: true, viewport: { width: 375, height: 667 },
});
const page = context.pages()[0] || await context.newPage();
const report = [];
try {
  await page.goto('http://localhost:5173/chat/1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  if (await page.locator('input[autocomplete="username"]').isVisible()) {
    const password = fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim();
    await page.locator('input[autocomplete="username"]').fill('dev_user_1@example.com');
    await page.locator('input[autocomplete="current-password"]').fill(password);
    const loggedIn = page.waitForResponse((response) =>
      response.url().endsWith('/auth/me') && response.status() === 200);
    await page.locator('button[type="submit"]').click();
    await loggedIn;
  }
  await page.goto('http://localhost:5173/chat/1', { waitUntil: 'domcontentloaded' });
  const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
  if (await unlock.isVisible({ timeout: 3000 }).catch(() => false)) {
    const passcode = fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim();
    await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true }).fill(passcode);
    await unlock.click();
  }
  const first = page.getByRole('button', { name: 'Open image full size' }).first();
  await first.waitFor({ timeout: 15000 });
  await first.click();
  const dialog = page.getByRole('dialog', { name: 'Image viewer' });
  await dialog.locator('.shared-image-viewer-image').waitFor();
  await page.waitForTimeout(300);
  for (const appearance of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: appearance });
    for (const theme of ['dawn', 'midnight', 'amoled', 'aurora', 'neon', 'sunset', 'solarized', 'velvet']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Close' }).focus();
      const measure = await dialog.evaluate((node) => {
        const parse = (value) => {
          const numbers = value.match(/[\d.]+/g)?.map(Number) || [];
          return numbers.slice(0, 3).map((channel) => {
            const s = channel / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        };
        const contrast = (left, right) => {
          const [r1, g1, b1] = parse(left);
          const [r2, g2, b2] = parse(right);
          const l1 = 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1;
          const l2 = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const bounds = (element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const dialogRect = bounds(node);
        return Object.fromEntries(['Close', 'Download'].map((name) => {
          const button = [...node.querySelectorAll('button')].find((item) =>
            item.textContent.trim() === name);
          const style = getComputedStyle(button);
          const rect = bounds(button);
          return [name.toLowerCase(), {
            color: style.color,
            background: style.backgroundColor,
            contrast: contrast(style.color, style.backgroundColor),
            focusOutline: name === 'Close' ? {
              style: style.outlineStyle,
              width: style.outlineWidth,
              color: style.outlineColor,
              contrast: contrast(style.outlineColor, getComputedStyle(node).backgroundColor),
            } : undefined,
            visible: rect.x >= dialogRect.x && rect.y >= dialogRect.y &&
              rect.x + rect.width <= dialogRect.x + dialogRect.width &&
              rect.y + rect.height <= dialogRect.y + dialogRect.height,
          }];
        }));
      });
      if (!measure.close.visible || !measure.download.visible) {
        throw new Error(`Viewer control outside dialog: ${theme} ${appearance}`);
      }
      if (measure.close.focusOutline.style !== 'solid' ||
          Number.parseFloat(measure.close.focusOutline.width) < 2 ||
          measure.close.focusOutline.contrast < 3) {
        throw new Error(`Viewer focus indicator insufficient: ${theme} ${appearance}`);
      }
      report.push({ theme, appearance, ...measure });
      if (appearance === 'light' && ['neon', 'velvet'].includes(theme)) {
        await page.screenshot({ path: path.join(output, `375-native-${theme}-viewer.png`) });
      }
    }
  }
  fs.writeFileSync(path.join(output, 'theme-controls.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.map(({ theme, appearance, close, download }) => ({
    theme, appearance,
    closeContrast: Math.round(close.contrast * 100) / 100,
    downloadContrast: Math.round(download.contrast * 100) / 100,
  })), null, 2));
} finally {
  await context.close();
}
