import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('Use before or after');
const output = path.dirname(fileURLToPath(import.meta.url));
const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
  .sort().reverse().map((name) => path.join(cache, name,
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Disposable Chromium unavailable');

const rgb = (value) => value.match(/\d+/g).slice(0, 3).map(Number);
const luminance = (channels) => channels.map((v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const composite = (fg, bg, opacity) => fg.map((v, i) => v * opacity + bg[i] * (1 - opacity));

const browser = await chromium.launch({ executablePath, headless: true });
const report = { phase, environment: 'Disposable localhost Chromium; Velvet forced only in this QA browser context', cases: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.locator('input[autocomplete="username"]').waitFor({ timeout: 15000 });
  await page.locator('input[autocomplete="username"]').fill('dev_user_2@example.com');
  await page.locator('input[autocomplete="current-password"]')
    .fill(fs.readFileSync(path.join(qaRoot, 'account-password'), 'utf8').trim());
  const signedIn = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/auth/login' && response.status() === 200, { timeout: 20000 });
  await page.locator('button[type="submit"]').click();
  await signedIn;
  const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
  await unlock.waitFor({ timeout: 60000 });
  await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true })
    .fill(fs.readFileSync(path.join(qaRoot, 'key-passcode-2'), 'utf8').trim());
  await unlock.click();
  await unlock.waitFor({ state: 'hidden', timeout: 30000 });
  await page.goto('http://localhost:5173/chat/1', { waitUntil: 'domcontentloaded' });
  await page.locator('.message-row').first().waitFor({ timeout: 15000 });

  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [width, height] of [[1280, 800], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'velvet'; });
      await page.waitForTimeout(120);

      const messages = page.locator('.message-row [role="text"]');
      const index = await messages.evaluateAll((nodes) => nodes.findIndex((node) =>
        getComputedStyle(node).backgroundImage.includes('linear-gradient')));
      if (index < 0) throw new Error('Outgoing native bubble unavailable');
      const bubble = messages.nth(index);
      const caption = page.locator('.outgoing-message-caption').first();
      const edited = page.locator('.outgoing-message-edited').first();
      if (!await caption.count() || !await edited.count()) throw new Error('Caption or edited fixture unavailable');
      await bubble.scrollIntoViewIfNeeded();
      const bubbleScreenshot = `${phase}-${width}-${scheme}-bubble.png`;
      await page.screenshot({ path: path.join(output, bubbleScreenshot), animations: 'disabled' });
      await caption.scrollIntoViewIfNeeded();
      const captionScreenshot = `${phase}-${width}-${scheme}-caption.png`;
      await page.screenshot({ path: path.join(output, captionScreenshot), animations: 'disabled' });

      const styles = await page.evaluate(({ index }) => {
        const bubble = [...document.querySelectorAll('.message-row [role="text"]')][index];
        const caption = document.querySelector('.outgoing-message-caption');
        const edited = document.querySelector('.outgoing-message-edited');
        const seen = [...document.querySelectorAll('.mantine-Text-root')]
          .find((node) => node.textContent.trim() === 'Seen');
        const root = getComputedStyle(document.documentElement);
        return {
          bubbleColor: getComputedStyle(bubble).color,
          gradient: getComputedStyle(bubble).backgroundImage,
          bubbleShadow: getComputedStyle(bubble).textShadow,
          captionColor: getComputedStyle(caption).color,
          captionOpacity: Number(getComputedStyle(caption).opacity),
          editedColor: getComputedStyle(edited).color,
          editedOpacity: Number(getComputedStyle(edited).opacity),
          seenColor: seen ? getComputedStyle(seen).color : null,
          seenOpacity: seen ? Number(getComputedStyle(seen).opacity) : null,
          pageBackground: root.getPropertyValue('--bg').trim(),
          card: root.getPropertyValue('--card').trim(),
          microphoneInk: root.getPropertyValue('--composer-ink').trim(),
          theme: document.documentElement.dataset.theme,
        };
      }, { index });
      if (styles.theme !== 'velvet') throw new Error('Theme override did not apply');

      await page.evaluate(() => {
        const panel = document.createElement('div');
        panel.id = 'velvet-gradient-sample';
        panel.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:200px;background:var(--bubble-outgoing);z-index:2147483647';
        document.body.appendChild(panel);
      });
      const gradientBytes = await page.locator('#velvet-gradient-sample').screenshot();
      await page.locator('#velvet-gradient-sample').evaluate((node) => node.remove());
      const { data, info } = await sharp(gradientBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const foreground = rgb(styles.bubbleColor);
      const editedColor = rgb(styles.editedColor);
      let minText = Infinity;
      let minEdited = Infinity;
      const sampleAt = (x, y) => {
        const offset = (y * info.width + x) * info.channels;
        const background = [...data.subarray(offset, offset + 3)];
        return { x, y, background: `#${background.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
          text: contrast(foreground, background),
          edited: contrast(composite(editedColor, background, styles.editedOpacity), background) };
      };
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const sample = sampleAt(x, y);
        minText = Math.min(minText, sample.text);
        minEdited = Math.min(minEdited, sample.edited);
      }
      const positions = [[1, 1], [100, 50], [200, 100], [300, 150], [398, 198]]
        .map(([x, y]) => sampleAt(x, y));
      const background = [1, 3, 5].map((i) => parseInt(styles.pageBackground.slice(i, i + 2), 16));
      const captionColor = rgb(styles.captionColor);
      const captionContrast = contrast(composite(captionColor, background, styles.captionOpacity), background);
      const seenContrast = styles.seenColor
        ? contrast(composite(rgb(styles.seenColor), background, styles.seenOpacity), background)
        : null;
      report.cases.push({ scheme, width, height, bubbleScreenshot, captionScreenshot,
        ...styles, renderedGradient: { minText, minEdited, positions }, captionContrast, seenContrast });
    }
  }
  await context.close();
  fs.writeFileSync(path.join(output, `${phase}-report.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase, cases: report.cases.length,
    minimumText: Math.min(...report.cases.map((item) => item.renderedGradient.minText)),
    minimumEdited: Math.min(...report.cases.map((item) => item.renderedGradient.minEdited)),
    minimumCaption: Math.min(...report.cases.map((item) => item.captionContrast)) }));
} finally { await browser.close(); }
