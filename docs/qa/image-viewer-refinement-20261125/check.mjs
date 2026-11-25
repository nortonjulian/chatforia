import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124/node_modules/playwright/index.mjs';

const worktree = '/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124';
const output = path.join(worktree, 'docs/qa/image-viewer-refinement-20261125');
const qaRoot = '/private/tmp/chatforia-webqa-20261124.QrNEHS';
fs.mkdirSync(output, { recursive: true });
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const executablePath = fs.readdirSync(cache).filter((entry) => /^chromium-\d+$/.test(entry)).sort().reverse()
  .map((entry) => path.join(cache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Local Chromium installation unavailable');
const fixtureHash = Object.fromEntries(['portrait', 'landscape', 'square'].map((shape) => [
  shape,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(qaRoot, 'fixtures', `${shape}.png`))).digest('hex'),
]));
const dimensions = {
  portrait: [640, 960],
  landscape: [960, 640],
  square: [800, 800],
};
const report = {
  environment: 'Authenticated disposable localhost QA; headless Chromium, not physical-device verification',
  baseline: 'docs/qa/image-viewer-parity-20261124/report.json',
  viewportPairs: [],
  gallery: [],
};
const write = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const context = await chromium.launchPersistentContext(path.join(qaRoot, 'browser-1'), {
  executablePath,
  headless: true,
  acceptDownloads: true,
  viewport: { width: 1440, height: 900 },
});
const page = context.pages()[0] || await context.newPage();
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

async function selectImage(shape, variant) {
  const [naturalWidth, naturalHeight] = dimensions[shape];
  const buttons = page.locator('button[aria-label="Open image full size"]');
  const matches = [];
  for (let index = 0, count = await buttons.count(); index < count; index++) {
    const button = buttons.nth(index);
    const geometry = await button.locator('img').evaluate((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
    if (geometry.width === naturalWidth && geometry.height === naturalHeight) matches.push(button);
  }
  if (matches.length < 2) throw new Error(`Missing ${shape} image-only/caption pair`);
  return matches[variant === 'caption' ? 1 : 0];
}

async function inspect(channel, width, height, shape, variant) {
  const button = await selectImage(shape, variant);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Image viewer' });
  await dialog.waitFor();
  const image = dialog.locator('.shared-image-viewer-image');
  await image.waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('.shared-image-viewer-image');
    return image?.complete && image.naturalWidth > 0;
  });
  await page.waitForTimeout(300); // Mantine's opening transition must finish before capture.
  const measured = await dialog.evaluate((node) => {
    const image = node.querySelector('.shared-image-viewer-image');
    const stage = node.querySelector('.shared-image-viewer-stage');
    const header = node.querySelector('.mantine-Modal-header');
    const close = [...node.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Close');
    const download = [...node.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Download');
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const style = getComputedStyle(image);
    return {
      image: { ...rect(image), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
        objectFit: style.objectFit, maxWidth: style.maxWidth, maxHeight: style.maxHeight },
      stage: rect(stage),
      dialog: rect(node),
      header: rect(header),
      close: rect(close),
      download: rect(download),
      backVisible: [...node.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Back to media'),
      caption: node.querySelector('.shared-image-viewer-caption')?.textContent || '',
      captionRect: node.querySelector('.shared-image-viewer-caption') ? rect(node.querySelector('.shared-image-viewer-caption')) : null,
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  if (measured.image.width > measured.image.naturalWidth + 1 ||
      measured.image.height > measured.image.naturalHeight + 1 ||
      measured.image.objectFit !== 'contain' ||
      measured.close.y < measured.header.y ||
      measured.close.y + measured.close.height > measured.header.y + measured.header.height ||
      measured.download.y + measured.download.height > measured.viewport.height ||
      (measured.captionRect && measured.captionRect.y + measured.captionRect.height > measured.viewport.height) ||
      measured.horizontalOverflow ||
      (width > 600 && measured.dialog.width > 921) ||
      measured.backVisible ||
      (variant === 'caption') !== Boolean(measured.caption)) {
    throw new Error(`Viewer geometry/caption mismatch: ${channel} ${width} ${shape} ${variant}`);
  }
  const filename = `${width}-${channel}-${shape}-${variant}.png`;
  await page.screenshot({ path: path.join(output, filename), fullPage: false });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    dialog.getByRole('button', { name: 'Download image' }).click(),
  ]);
  const bytes = fs.readFileSync(await download.path());
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== fixtureHash[shape]) throw new Error(`Download hash mismatch: ${channel} ${shape}`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const focusRestored = await button.evaluate((element) => document.activeElement === element);
  return { channel, width, height, shape, variant, screenshot: filename, ...measured,
    downloadName: download.suggestedFilename(), downloadSha256: hash, focusRestored };
}

try {
  for (const [width, height] of [[1440, 900], [390, 844], [375, 667]]) {
    await page.setViewportSize({ width, height });
    for (const channel of ['native', 'mms']) {
      await page.goto(channel === 'native'
        ? 'http://localhost:5173/chat/1'
        : 'http://localhost:5173/sms/1', { waitUntil: 'domcontentloaded' });
      const unlock = page.getByRole('button', { name: 'Unlock secure messages' });
      if (await unlock.isVisible({ timeout: 3000 }).catch(() => false)) {
        const passcode = fs.readFileSync(path.join(qaRoot, 'key-passcode-1'), 'utf8').trim();
        await page.getByRole('textbox', { name: 'Secure Messages Passcode', exact: true }).fill(passcode);
        await unlock.click();
      }
      try {
        await page.waitForFunction(() => {
          const images = [...document.querySelectorAll('button[aria-label="Open image full size"] img')];
          return images.filter((image) => image.complete && image.naturalWidth > 0).length >= 6;
        }, null, { timeout: 10000 });
      } catch (error) {
        await page.screenshot({ path: path.join(output, `debug-${width}-${channel}.png`) });
        const pageState = await page.evaluate(() => ({
          path: location.pathname,
          buttons: document.querySelectorAll('button[aria-label="Open image full size"]').length,
          loadedImages: [...document.querySelectorAll('button[aria-label="Open image full size"] img')]
            .filter((image) => image.complete && image.naturalWidth > 0).length,
          text: document.body.innerText.slice(0, 500),
        }));
        console.error('Browser fixture readiness:', JSON.stringify(pageState));
        throw error;
      }
      for (const shape of ['portrait', 'landscape', 'square']) {
        report.viewportPairs.push(await inspect(channel, width, height, shape, 'image-only'));
        write();
      }
      report.viewportPairs.push(await inspect(channel, width, height, 'portrait', 'caption'));
      write();
    }
  }
  for (const width of [1440, 390, 375]) {
    for (const shape of ['portrait', 'landscape', 'square']) {
      const native = report.viewportPairs.find((row) => row.width === width &&
        row.channel === 'native' && row.shape === shape && row.variant === 'image-only');
      const mms = report.viewportPairs.find((row) => row.width === width &&
        row.channel === 'mms' && row.shape === shape && row.variant === 'image-only');
      const sameImage = Math.abs(native.image.width - mms.image.width) <= 1 &&
        Math.abs(native.image.height - mms.image.height) <= 1;
      const sameDialog = Math.abs(native.dialog.width - mms.dialog.width) <= 1 &&
        Math.abs(native.dialog.height - mms.dialog.height) <= 1;
      if (!sameImage || !sameDialog) throw new Error(`Viewer parity mismatch: ${width} ${shape}`);
    }
  }
  write();
  const previous = JSON.parse(fs.readFileSync(path.join(worktree, report.baseline), 'utf8'));
  const desktopReduction = report.viewportPairs.filter((row) => row.width === 1440 && row.channel === 'native').map((row) => {
    const prior = previous.viewportPairs.find((entry) => entry.width === 1440 && entry.channel === 'native' &&
      entry.shape === row.shape && entry.variant === row.variant);
    const oldLongEdge = Math.max(prior.image.width, prior.image.height);
    const newLongEdge = Math.max(row.image.width, row.image.height);
    return { shape: row.shape, variant: row.variant, oldLongEdge, newLongEdge,
      reductionPercent: Math.round((1 - newLongEdge / oldLongEdge) * 1000) / 10 };
  });
  report.desktopReduction = desktopReduction;
  if (desktopReduction.some((row) => row.reductionPercent < 12 || row.reductionPercent > 19)) {
    throw new Error('Desktop image reduction differs from the approved approximate 15% target');
  }
  write();
  console.log(JSON.stringify({ pairedScreenshots: report.viewportPairs.length,
    comparedShapes: 9, downloadsMatchedOriginal: true,
    focusRestored: report.viewportPairs.every((row) => row.focusRestored),
    desktopReduction,
    report: path.join(output, 'report.json') }, null, 2));
} finally {
  write();
  await context.close();
}
