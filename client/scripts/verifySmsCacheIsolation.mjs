// Local Chromium regression for the browser's real IndexedDB implementation.
// Run with: node client/scripts/verifySmsCacheIsolation.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const modulePath = fileURLToPath(new URL('../src/utils/smsMessagesStore.js', import.meta.url));
const source = await readFile(modulePath, 'utf8');
let mediaRequests = 0;
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/sms/media/42/0') {
    mediaRequests += 1;
    if (req.headers.cookie?.includes('account=A')) {
      res.setHeader('Content-Type', 'text/plain');
      res.end('account A bytes');
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } else if (req.url === '/smsMessagesStore.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(source);
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>SMS cache isolation test</title>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const httpResult = await page.evaluate(async () => {
    document.cookie = 'account=A';
    const first = await fetch('/sms/media/42/0');
    const firstBody = await first.text();
    document.cookie = 'account=; Max-Age=0';
    const signedOut = await fetch('/sms/media/42/0');
    document.cookie = 'account=B';
    const second = await fetch('/sms/media/42/0');
    return { firstStatus: first.status, firstBody, signedOutStatus: signedOut.status, secondStatus: second.status };
  });
  assert.deepEqual(httpResult, {
    firstStatus: 200, firstBody: 'account A bytes', signedOutStatus: 404, secondStatus: 404,
  });
  assert.equal(mediaRequests, 3, 'every no-store request must reach the server');
  const result = await page.evaluate(async () => {
    const openOld = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('chatforia_sms_db', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('sms_messages', { keyPath: 'key' });
        store.createIndex('threadId', 'threadId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const oldDb = await openOld();
    await new Promise((resolve, reject) => {
      const transaction = oldDb.transaction('sms_messages', 'readwrite');
      transaction.objectStore('sms_messages').put({
        key: '19:42', threadId: '19', id: 42, body: 'legacy private text', createdAt: '2026-01-01',
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    oldDb.close();

    const store = await import('/smsMessagesStore.js');
    const legacy = await store.searchSmsMessages('7', '19', 'legacy');
    await store.addSmsMessages('7', '19', [{
      id: 42, body: 'account A private text', mediaUrls: ['a-private.jpg'], createdAt: '2026-02-01',
    }]);
    await store.addSmsMessages('8', '19', [{
      id: 42, body: 'account B private text', mediaUrls: ['b-private.jpg'], createdAt: '2026-02-02',
    }]);
    const aBefore = await store.searchSmsMessages('7', '19', 'private');
    const bBefore = await store.searchSmsMessages('8', '19', 'private');
    const bCannotSearchA = await store.searchSmsMessages('8', '19', 'account A');
    const aMedia = await store.getSmsMediaItemsAsync('7', '19');
    const bMedia = await store.getSmsMediaItemsAsync('8', '19');
    await store.clearSmsMessagesForAccount('7');
    const aAfter = await store.searchSmsMessages('7', '19', 'private');
    const bAfter = await store.searchSmsMessages('8', '19', 'private');
    return { legacy, aBefore, bBefore, bCannotSearchA, aMedia, bMedia, aAfter, bAfter };
  });
  assert.equal(result.legacy.length, 0, 'unowned version-1 rows must be discarded');
  assert.equal(result.aBefore[0]?.body, 'account A private text');
  assert.equal(result.bBefore[0]?.body, 'account B private text');
  assert.equal(result.bCannotSearchA.length, 0);
  assert.deepEqual(result.aMedia.map(item => item.url), ['a-private.jpg']);
  assert.deepEqual(result.bMedia.map(item => item.url), ['b-private.jpg']);
  assert.equal(result.aAfter.length, 0);
  assert.equal(result.bAfter[0]?.body, 'account B private text');
  console.log('PASS: no-store browser retrieval after A/logout/B, version-1 eviction, account-scoped search/media, account-A clear, account-B retention');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
