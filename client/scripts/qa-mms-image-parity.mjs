import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../..');
const outputDir = path.join(root, 'docs/qa/mms-image-parity-20261124');
fs.mkdirSync(outputDir, { recursive: true });
const siteOrigin = process.env.CHATFORIA_QA_SITE || 'http://127.0.0.1:5175';
const apiOrigin = 'http://127.0.0.1:59999';
const fixtures = {
  portrait: { width: 480, height: 960, color: '#4667f5' },
  landscape: { width: 960, height: 480, color: '#a83b80' },
  square: { width: 640, height: 640, color: '#366b55' },
};
const browserCache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const installedChrome = fs.existsSync(browserCache)
  ? fs.readdirSync(browserCache).filter((entry) => /^chromium-\d+$/.test(entry)).sort().reverse()
    .map((entry) => path.join(browserCache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    .find((candidate) => fs.existsSync(candidate))
  : null;
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHATFORIA_QA_CHROME || installedChrome
    ? { executablePath: process.env.CHATFORIA_QA_CHROME || installedChrome } : {}) });
const results = [];

const svg = ({ width, height, color }, name) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="white"/><text x="50%" y="90%" fill="white" font-size="48" text-anchor="middle">${name}</text></svg>`
);

async function mockApi(page, name) {
  const attachment = { id: 501, kind: 'IMAGE', mimeType: 'image/svg+xml', url: `${apiOrigin}/fixtures/${name}.svg` };
  const when = '2026-11-24T14:00:00.000Z';
  const nativeMessages = [
    { id: 101, chatRoomId: 10, rawContent: '', sender: { id: 2, username: 'peer' }, createdAt: when, attachments: [attachment] },
    { id: 102, chatRoomId: 10, rawContent: 'QA image caption', sender: { id: 1, username: 'viewer' }, createdAt: '2026-11-24T14:01:00.000Z', attachments: [{ ...attachment, id: 502 }] },
  ];
  const smsMessages = [
    { id: 11, body: '', mediaUrls: [{ url: `opaque-${name}`, contentType: 'image/svg+xml' }], direction: 'inbound', createdAt: when },
    { id: 12, body: 'QA image caption', mediaUrls: [{ url: `opaque-${name}`, contentType: 'image/svg+xml' }], direction: 'outbound', createdAt: '2026-11-24T14:01:00.000Z' },
    { id: 13, body: '', mediaUrls: [{ url: 'opaque-failed', contentType: 'image/svg+xml' }], direction: 'inbound', createdAt: '2026-11-24T14:02:00.000Z' },
  ];
  await page.addInitScript((origin) => {
    window.__API_URL__ = origin;
    window.__WS_URL__ = origin.replace('http:', 'ws:');
    localStorage.setItem('token', 'synthetic-image-parity-qa');
  }, apiOrigin);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === siteOrigin) return route.continue();
    if (url.origin !== apiOrigin) return route.abort();
    if (url.pathname === `/fixtures/${name}.svg`) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(fixtures[name], name) });
    if (url.pathname === '/sms/media/11/0') {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(fixtures[name], name) });
    }
    if (url.pathname === '/sms/media/12/0') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(fixtures[name], name) });
    if (url.pathname === '/sms/media/13/0') return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic unavailable media' });
    let body = {};
    if (url.pathname === '/auth/me') body = { user: { id: 1, username: 'viewer', displayName: 'QA Viewer', theme: 'dawn', plan: 'PREMIUM', isPremium: true, publicKey: null } };
    else if (url.pathname === '/chatrooms/10') body = { id: 10, name: 'QA Room', participants: [{ userId: 1, user: { id: 1, username: 'viewer' } }, { userId: 2, user: { id: 2, username: 'peer' } }] };
    else if (url.pathname === '/messages/10') body = { items: nativeMessages, nextCursor: null };
    else if (url.pathname === '/chatrooms') body = [];
    else if (url.pathname === '/sms/threads/qa-thread') body = { id: 'qa-thread', displayName: 'Synthetic SMS', contactPhone: '+15555550100', messages: smsMessages };
    else if (url.pathname === '/auth/csrf') body = { csrfToken: 'synthetic' };
    else if (url.pathname === '/features') body = { status: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function measure(page, selector) {
  return page.locator(selector).evaluateAll((images) => images.map((image) => {
    const box = image.getBoundingClientRect();
    const row = image.closest('.message-row, .sms-message-row');
    const bubble = image.closest('.sms-bubble');
    const caption = [...row.querySelectorAll('*')].find((node) =>
      node.children.length === 0 && node.textContent?.trim() === 'QA image caption');
    const captionBox = caption?.getBoundingClientRect();
    return {
      width: box.width, height: box.height,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      radius: getComputedStyle(image).borderRadius,
      objectFit: getComputedStyle(image).objectFit,
      edgeInset: caption ? row.getBoundingClientRect().right - box.right : box.left - row.getBoundingClientRect().left,
      bubbleBackground: bubble ? getComputedStyle(bubble).backgroundColor : null,
      captionBelow: captionBox ? captionBox.top >= box.bottom : null,
      overflow: box.right > innerWidth + 1,
    };
  }));
}

try {
  for (const width of [1280, 390]) for (const name of Object.keys(fixtures)) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    await mockApi(page, name);
    await page.goto(`${siteOrigin}/chat/10`, { waitUntil: 'domcontentloaded' });
    const nativeImages = page.locator('.message-row img[alt="Attachment"]');
    await nativeImages.nth(1).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.message-row img[alt="Attachment"]')].every((image) => image.complete && image.naturalWidth > 0));
    const native = await measure(page, '.message-row img[alt="Attachment"]');
    for (let index = 0; index < 2; index++) {
      await page.locator('.message-row:has(img[alt="Attachment"])').nth(index).screenshot({ path: path.join(outputDir, `${name}-${width}-native-${index}.png`) });
    }
    await page.goto(`${siteOrigin}/sms/qa-thread`, { waitUntil: 'domcontentloaded' });
    const loadingBubble = page.locator('[data-sms-msg-id="11"] .sms-bubble');
    await loadingBubble.getByText('Loading attachment…').waitFor({ timeout: 10000 });
    const loadingTransparent = await loadingBubble.evaluate((node) => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)');
    const failureBubble = page.locator('[data-sms-msg-id="13"] .sms-bubble');
    await failureBubble.getByRole('alert').waitFor({ timeout: 10000 });
    const failureTransparent = await failureBubble.evaluate((node) => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)');
    const smsImages = page.locator('.sms-message-row .sms-media-open img');
    await smsImages.nth(1).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.sms-message-row .sms-media-open img')].length === 2 &&
      [...document.querySelectorAll('.sms-message-row .sms-media-open img')].every((image) => image.complete && image.naturalWidth > 0));
    const sms = await measure(page, '.sms-message-row .sms-media-open img');
    for (let index = 0; index < 2; index++) {
      await page.locator('.sms-message-row:has(.sms-media-open img)').nth(index).screenshot({ path: path.join(outputDir, `${name}-${width}-mms-${index}.png`) });
    }
    await page.getByRole('button', { name: 'Open MMS image in media gallery' }).first().focus();
    const focus = await page.getByRole('button', { name: 'Open MMS image in media gallery' }).first()
      .evaluate((node) => getComputedStyle(node).outlineStyle);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Open MMS image full size' }).first().waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Open MMS image full size' }).first().focus();
    await page.keyboard.press('Enter');
    const viewer = page.getByRole('dialog', { name: 'MMS image preview' });
    await viewer.getByRole('img', { name: 'MMS attachment' }).waitFor({ timeout: 5000 });
    const viewerImage = viewer.getByRole('img', { name: 'MMS attachment' });
    await viewerImage.evaluate((image) => image.decode());
    const viewerReady = await viewer.getByRole('link', { name: 'Download MMS image' }).count() === 1;
    await viewer.screenshot({ path: path.join(outputDir, `${name}-${width}-mms-viewer.png`) });
    await viewer.getByRole('button', { name: 'Back to media' }).focus();
    await page.keyboard.press('Enter');
    const galleryButton = page.getByRole('dialog', { name: 'Media — Synthetic SMS' })
      .getByRole('button', { name: 'Open MMS image full size' }).first();
    const returnedToGallery = await galleryButton.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    const check = { name, width, native, sms, loadingTransparent, failureTransparent, focus, viewerReady,
      returnedToGallery,
      horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) };
    results.push(check);
    if (native.length !== 2 || sms.length !== 2 || !loadingTransparent || !failureTransparent ||
      focus !== 'solid' || !viewerReady || !returnedToGallery || check.horizontalOverflow ||
      native.some((item, index) => Math.abs(item.width - sms[index].width) > 1 ||
        Math.abs(item.height - sms[index].height) > 1 ||
        item.naturalWidth !== sms[index].naturalWidth || item.naturalHeight !== sms[index].naturalHeight ||
        item.radius !== sms[index].radius || item.overflow || sms[index].overflow ||
        Math.abs(item.edgeInset - sms[index].edgeInset) > 1 ||
        (index === 1 && (!item.captionBelow || !sms[index].captionBelow)))) {
      throw new Error(`Image parity failed: ${JSON.stringify(check)}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify({ siteOrigin, results }, null, 2)}\n`);
}
console.log(`Checked ${results.length} paired native/MMS fixtures at desktop and mobile widths.`);
console.log(`Evidence: ${path.join(outputDir, 'report.json')}`);
