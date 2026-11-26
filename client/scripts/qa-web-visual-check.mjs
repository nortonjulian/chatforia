import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '../..');
const outputDir = path.join(root, 'docs/qa/browser-evidence-20261124');
fs.mkdirSync(outputDir, { recursive: true });
const browserCache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const installedChrome = fs.existsSync(browserCache)
  ? fs.readdirSync(browserCache).filter((entry) => /^chromium-\d+$/.test(entry)).sort().reverse()
    .map((entry) => path.join(browserCache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    .find((candidate) => fs.existsSync(candidate))
  : null;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHATFORIA_QA_CHROME || installedChrome
    ? { executablePath: process.env.CHATFORIA_QA_CHROME || installedChrome }
    : {}),
});

const apiOrigin = 'http://127.0.0.1:59999';
const siteOrigin = process.env.CHATFORIA_QA_SITE || 'http://127.0.0.1:5175';
const themes = ['dawn', 'midnight', 'amoled', 'aurora', 'neon', 'sunset', 'solarized', 'velvet'];
const incoming = { id: 1, chatRoomId: 10, rawContent: 'QA incoming message', sender: { id: 2, username: 'peer' }, createdAt: '2026-11-24T14:00:00.000Z', attachments: [] };
const outgoing = { id: 2, chatRoomId: 10, rawContent: 'QA outgoing message', sender: { id: 1, username: 'viewer' }, createdAt: '2026-11-24T14:01:00.000Z', attachments: [] };
const smsMessages = [
  { id: 11, body: '', mediaUrls: [{ url: 'opaque-image-only', contentType: 'image/png' }], direction: 'inbound', createdAt: '2026-11-24T14:02:00.000Z' },
  { id: 12, body: 'QA caption with image', mediaUrls: [{ url: 'opaque-mixed', contentType: 'image/png' }], direction: 'outbound', createdAt: '2026-11-24T14:03:00.000Z' },
];
const imageBytes = fs.readFileSync(path.join(root, 'client/public/qr-chatforia.png'));
const samples = [];
const smsResults = [];

function luminance(rgb) {
  return rgb.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(a, b) {
  const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((bright + 0.05) / (dark + 0.05)) * 100) / 100;
}
function rgb(value) {
  return [...value.matchAll(/[\d.]+/g)].slice(0, 3).map(([number]) => Number(number));
}
function pixel(png, x, y) {
  const ix = Math.min(png.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(png.height - 1, Math.max(0, Math.round(y)));
  const offset = (iy * png.width + ix) * 4;
  return [...png.data.subarray(offset, offset + 3)];
}

async function mockApi(page) {
  await page.addInitScript((origin) => {
    window.__API_URL__ = origin;
    window.__WS_URL__ = origin.replace('http:', 'ws:');
    localStorage.setItem('token', 'synthetic-browser-qa');
  }, apiOrigin);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === siteOrigin) return route.continue();
    if (url.origin !== apiOrigin) return route.abort();
    let body = {};
    if (url.pathname === '/auth/me') body = { user: { id: 1, username: 'viewer', displayName: 'QA Viewer', theme: 'dawn', plan: 'PREMIUM', isPremium: true, publicKey: null } };
    else if (url.pathname === '/chatrooms/10') body = { id: 10, name: 'QA Room', participants: [{ userId: 1, user: { id: 1, username: 'viewer' } }, { userId: 2, user: { id: 2, username: 'peer' } }] };
    else if (url.pathname === '/messages/10') body = { items: [outgoing, incoming], nextCursor: null };
    else if (url.pathname === '/chatrooms') body = [];
    else if (url.pathname === '/sms/threads/qa-thread') body = { id: 'qa-thread', displayName: 'Synthetic SMS', contactPhone: '+15555550100', messages: smsMessages };
    else if (/^\/sms\/media\/\d+\/\d+$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes });
    else if (url.pathname === '/auth/csrf') body = { csrfToken: 'synthetic' };
    else if (url.pathname === '/features') body = { status: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    await mockApi(page);
    await page.goto(`${siteOrigin}/chat/10`, { waitUntil: 'domcontentloaded' });
    await page.getByText('QA incoming message').waitFor({ timeout: 15000 });
    await page.getByText('QA outgoing message').waitFor({ timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const theme of themes) {
        await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
        await page.waitForTimeout(350);
        const locator = page.locator('[role="text"]').filter({ hasText: 'QA outgoing message' }).first();
        const box = await locator.boundingBox();
        const clip = await locator.screenshot();
        const png = PNG.sync.read(clip);
        const foreground = rgb(await locator.evaluate((node) => getComputedStyle(node).color));
        const gradient = [pixel(png, png.width * 0.15, 3), pixel(png, png.width * 0.50, 3), pixel(png, png.width * 0.85, png.height - 4)];
        const incomingContrast = await page.locator('[role="text"]').filter({ hasText: 'QA incoming message' }).first()
          .evaluate((node) => {
            const parse = (value) => [...value.matchAll(/[\d.]+/g)].slice(0, 3).map(([number]) => Number(number));
            const style = getComputedStyle(node);
            return { text: parse(style.color), background: parse(style.backgroundColor) };
          });
        const state = await page.evaluate(() => ({
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          foreground: getComputedStyle(document.documentElement).getPropertyValue('--fg').trim(),
          incoming: getComputedStyle(document.documentElement).getPropertyValue('--bubble-incoming-bg').trim(),
          composerBackground: getComputedStyle(document.querySelector('.thread-composer-shell')).backgroundColor,
          expectedComposerBackground: (() => {
            const probe = document.createElement('span');
            probe.style.background = 'var(--composer-bg)';
            document.body.append(probe);
            const color = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return color;
          })(),
          toolbarIcon: getComputedStyle(document.querySelector('button[aria-label="Search messages"]')).color,
          navigationIcon: getComputedStyle(document.querySelector('.mantine-Burger-burger')).backgroundColor,
          headerBackground: getComputedStyle(document.querySelector('.mantine-AppShell-header')).backgroundColor,
          composerPlaceholder: getComputedStyle(document.querySelector('textarea[aria-label="Message composer"]'), '::placeholder').color,
          composerFieldBackground: getComputedStyle(document.querySelector('textarea[aria-label="Message composer"]')).backgroundColor,
          expectedToolbarIcon: (() => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--toolbar-icon)';
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          })(),
        }));
        if (state.scrollWidth > state.viewport + 1 || box.x < 0 || box.x + box.width > state.viewport + 1 ||
            state.composerBackground !== state.expectedComposerBackground || state.toolbarIcon !== state.expectedToolbarIcon ||
            state.navigationIcon !== state.expectedToolbarIcon) {
          throw new Error(`Theme layout or composer mismatch: ${theme} ${width}px ${scheme}: ${JSON.stringify({ state, box })}`);
        }
        const screenshot = `${theme}-${width}-${scheme}.png`;
        await page.screenshot({ path: path.join(outputDir, screenshot), fullPage: false });
        await page.keyboard.press('Tab');
        await page.getByRole('button', { name: 'Search messages' }).focus();
        const focus = await page.getByRole('button', { name: 'Search messages' }).evaluate((node) => {
          const style = getComputedStyle(node);
          return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
        });
        if (focus.style !== 'solid' || Number.parseFloat(focus.width) < 2) {
          throw new Error(`Missing keyboard focus: ${theme} ${width}px ${scheme}: ${JSON.stringify(focus)}`);
        }
        await page.getByRole('button', { name: 'Search messages' }).evaluate((node) => node.blur());
        samples.push({ theme, width, scheme, screenshot, ...state,
          outgoingText: foreground, outgoingGradientSamples: gradient,
          outgoingTextContrast: gradient.map((background) => contrast(foreground, background)),
          incomingTextContrast: contrast(incomingContrast.text, incomingContrast.background),
          toolbarIconContrast: contrast(rgb(state.toolbarIcon), rgb(state.headerBackground)),
          composerPlaceholderContrast: contrast(rgb(state.composerPlaceholder), rgb(state.composerFieldBackground)),
          focus,
          focusContrast: contrast(rgb(focus.color), rgb(state.headerBackground)),
          outgoingBubbleWidth: Math.round(box.width),
        });
      }
    }
    await page.goto(`${siteOrigin}/sms/qa-thread`, { waitUntil: 'domcontentloaded' });
    const buttons = page.getByRole('button', { name: 'Open MMS image in media gallery' });
    await buttons.first().waitFor({ timeout: 15000 });
    const buttonCount = await buttons.count();
    const layout = await page.evaluate(() => [...document.querySelectorAll('.sms-media-open')].map((button) => ({
      width: Math.round(button.getBoundingClientRect().width),
      imageWidth: Math.round(button.querySelector('img').getBoundingClientRect().width),
      imageAlt: button.querySelector('img').alt,
      bubbleTransparent: getComputedStyle(button.closest('.sms-bubble')).backgroundColor === 'rgba(0, 0, 0, 0)',
      bubbleBackground: getComputedStyle(button.closest('.sms-bubble')).background,
      inlineStyle: button.closest('.sms-bubble').getAttribute('style'),
      padding: getComputedStyle(button.closest('.sms-bubble')).padding,
      mediaOnly: button.closest('.sms-bubble').dataset.mediaOnly,
      imageOnlyRuleMatches: button.closest('.sms-bubble').matches('.sms-bubble[data-media-only="true"]:has(.sms-media-open):not(:has(audio, video, a))'),
      focusable: button.tabIndex >= 0,
    })));
    const smsScreenshot = `sms-mms-${width}.png`;
    await page.screenshot({ path: path.join(outputDir, smsScreenshot), fullPage: false });
    await buttons.first().focus();
    const focusOutline = await buttons.first().evaluate((node) => getComputedStyle(node).outlineStyle);
    await page.keyboard.press('Enter');
    const openedByKeyboard = await page.getByRole('dialog').waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    smsResults.push({ width, buttonCount, layout, focusOutline, openedByKeyboard, overflow, screenshot: smsScreenshot });
    if (buttonCount !== 2 || layout[0]?.width !== 220 || layout[1]?.width !== 140 ||
        !layout[0]?.bubbleTransparent || layout[1]?.mediaOnly === 'true' ||
        focusOutline !== 'solid' || !openedByKeyboard || overflow) {
      throw new Error(`SMS image layout or keyboard check failed at ${width}px: ${JSON.stringify(smsResults.at(-1))}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}

const report = { baseline: 'local checkpoint; synthetic API responses; no production data', siteOrigin,
  chromium: browser.version(), themeResults: samples, smsResults };
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Checked ${samples.length} theme appearances and ${smsResults.length} SMS layouts`);
console.log(`Evidence: ${path.join(outputDir, 'report.json')}`);
