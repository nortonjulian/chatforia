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
if (!executablePath) throw new Error('Local Chromium is unavailable');

const context = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
  executablePath, headless: true, viewport: { width: 390, height: 780 },
});
const page = context.pages()[0] || await context.newPage();
const result = { environment: 'Authenticated disposable localhost Chromium; not a physical device', cases: [] };
const widths = [360, 375, 390, 440, 488, 768, 1032, 1280];
const routes = [
  ['native-new', '/'],
  ['native-existing', '/chat/1'],
  ['sms-new', '/sms/compose'],
  ['sms-existing', '/sms/1'],
];

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
if (await page.locator('input[autocomplete="username"]').isVisible({ timeout: 10000 }).catch(() => false)) {
  const password = fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim();
  await page.locator('input[autocomplete="username"]').fill('dev_user_1@example.com');
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const signedIn = page.waitForResponse((response) =>
    response.url().endsWith('/auth/me') && response.status() === 200, { timeout: 20000 });
  await page.locator('button[type="submit"]').click();
  await signedIn;
}

for (const [name, route] of routes) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 488 ? 780 : 900 });
    await page.goto(`http://localhost:5173${route}`, { waitUntil: 'domcontentloaded' });
    const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
    if (await unlock.isVisible({ timeout: 1500 }).catch(() => false)) {
      const passcode = fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim();
      await page.locator('input[type="password"]').last().fill(passcode);
      await unlock.click();
    }
    const composer = page.locator('.responsive-message-composer').last();
    try {
      await composer.waitFor({ timeout: 15000 });
    } catch (error) {
      console.error('Composer unavailable', { name, width, url: page.url(), body: (await page.locator('body').innerText()).slice(0, 400) });
      throw error;
    }
    const metrics = await composer.evaluate((node) => {
      const rect = (element) => {
        const bounds = element?.getBoundingClientRect();
        return bounds && { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
      };
      const attachment = node.querySelector('.composer-attachment-row');
      const inputRow = node.querySelector('.composer-input-row');
      const textarea = node.querySelector('textarea');
      const send = inputRow?.querySelector('button');
      return {
        composer: rect(node), attachment: rect(attachment), inputRow: rect(inputRow),
        input: rect(textarea), send: rect(send),
        placeholderWhiteSpace: getComputedStyle(textarea, '::placeholder').whiteSpace,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const helpVisible = await page.getByRole('button', { name: 'Open support' }).isVisible().catch(() => false);
    const controls = await composer.locator('button:visible').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') || button.textContent?.trim()));
    const rowSplit = width <= 850 ? metrics.attachment.y < metrics.inputRow.y : true;
    const pass = !metrics.horizontalOverflow && !helpVisible && rowSplit && metrics.input.width >= 150 && metrics.placeholderWhiteSpace === 'nowrap';
    result.cases.push({ name, route, width, ...metrics, controls, helpVisible, rowSplit, pass });
    if ([360, 390, 768, 1280].includes(width)) {
      await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
    }
  }
}

await page.goto('http://localhost:5173/random', { waitUntil: 'domcontentloaded' });
result.helpOnRandom = await page.getByRole('button', { name: 'Open support' }).isVisible().catch(() => false);
await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' });
result.helpOnSettings = await page.getByRole('button', { name: 'Open support' }).isVisible().catch(() => false);
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n');
await context.close();
if (result.cases.some((entry) => !entry.pass) || result.helpOnRandom || !result.helpOnSettings) process.exitCode = 1;
