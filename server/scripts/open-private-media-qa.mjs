/**
 * Open a disposable, short-lived protected-media fixture in the booted iOS
 * simulator and Android emulator browser. This tests native browser decoders,
 * NOT in-app Chatforia media playback or production R2.
 *
 * The QA server must be running via serve-private-media-local-qa.mjs.
 * node server/scripts/open-private-media-qa.mjs image|thumb|audio|file
 *
 * No bearer tokens or grant URLs are printed.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const type = process.argv[2] || 'image';
if (!['image', 'thumb', 'audio', 'file'].includes(type)) {
  throw new Error('Choose image, thumb, audio or file');
}
const root = os.tmpdir();
const candidates = [];
for (const item of await fs.readdir(root, { withFileTypes: true })) {
  if (!item.isDirectory() || !/^chatforia-private-media-qa-[A-Za-z0-9_-]+$/.test(item.name)) continue;
  const file = path.join(root, item.name, 'session.json');
  try {
    const stat = await fs.stat(file);
    if (stat.isFile()) candidates.push(file);
  } catch {}
}
if (candidates.length !== 1) {
  throw new Error('Expected exactly one running local QA session, found ' + candidates.length +
    '. Stop stale sessions or inspect the QA server output; never use production tokens.');
}
const info = JSON.parse(await fs.readFile(candidates[0], 'utf8'));
const token = info?.token?.receiver;
if (typeof token !== 'string' || token.length < 10) {
  throw new Error('Disposable receiver QA token missing');
}
const endpoint = 'http://127.0.0.1:5502';
const guardedFetch = async (url, options = {}) => {
  const res = await fetch(url, { ...options, redirect: 'manual' });
  return res;
};
const health = await guardedFetch(endpoint + '/qa/health');
if (health.status !== 200 || (await health.json()).purpose !== 'isolated-private-media-qa') {
  throw new Error('Expected QA-only local API on port 5502');
}
const files = await guardedFetch(endpoint + '/qa/fixtures', {
  headers: { Authorization: 'Bearer ' + token },
});
if (files.status !== 200) throw new Error('QA account/fixture discovery failed: HTTP ' + files.status);
const { attachments } = await files.json();
const id = type === 'thumb' ? attachments.image : attachments[type];
if (!Number.isSafeInteger(id) || id <= 0) throw new Error('No QA fixture for ' + type);
const variant = type === 'thumb' ? 'thumb' : 'file';
const issue = await guardedFetch(endpoint + '/private-media/message/' + id + '?variant=' + variant, {
  headers: { Authorization: 'Bearer ' + token },
});
if (issue.status !== 200) throw new Error('QA grant issuance failed: HTTP ' + issue.status);
const { url } = await issue.json();
if (typeof url !== 'string' || !/^\/private-media\/file\?token=[A-Za-z0-9%._-]+$/.test(url)) {
  throw new Error('Unexpected media capability format; refusing to open it');
}
// Check bytes (without printing credentials) before launching browsers.
const get = await guardedFetch(endpoint + url);
if (get.status !== 200) throw new Error('QA attachment download failed: HTTP ' + get.status);
const bytes = await get.arrayBuffer();
if (bytes.byteLength === 0) throw new Error('Attachment contains no data');
console.log('PASS: ' + type + ' authorized grant and bytes (' + bytes.byteLength + ' bytes)');

const iosId = '9953F863-217B-45EF-9F3B-38D925E65198'; // Booted QA iPhone 18 Pro
try {
  execFileSync('xcrun', ['simctl', 'openurl', iosId, endpoint + url],
    { stdio: 'pipe', timeout: 12000 });
  console.log('iOS simulator: protected ' + type + ' opened in browser');
} catch {
  console.warn('iOS simulator: could not open protected ' + type + '; check booted device');
}
try {
  execFileSync('adb', ['-s', 'emulator-5554', 'shell', 'am', 'start',
    '-a', 'android.intent.action.VIEW', '-d', 'http://10.0.2.2:5502' + url],
    { stdio: 'pipe', timeout: 12000 });
  console.log('Android emulator: protected ' + type + ' opened in browser');
} catch {
  console.warn('Android emulator: could not open protected ' + type + '; check booted emulator');
}
console.log('Inspect both screens promptly. URLs expire in 60 seconds.');
console.log('Do not paste or share URLs containing capability tokens.');
