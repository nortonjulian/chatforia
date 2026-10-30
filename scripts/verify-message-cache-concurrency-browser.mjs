import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('client');
const fixture = path.join(root, '__qa_message_cache_concurrency.html');

let server;
let browser;
let createdFixture = false;

try {
  await writeFile(fixture, `
    <!doctype html>
    <html>
      <body>
        <script type="module">
          import * as store from '/src/utils/messagesStore.js';
          window.qaStore = store;
        </script>
      </body>
    </html>
  `, { flag: 'wx' });

  createdFixture = true;

  server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.js'),
    server: {
      host: '127.0.0.1',
      port: 0,
    },
  });

  await server.listen();

  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const page = await browser.newPage();

  const port = server.httpServer.address().port;

  await page.goto(
    `http://127.0.0.1:${port}/__qa_message_cache_concurrency.html`
  );

  await page.waitForFunction(() => Boolean(window.qaStore));

  const result = await page.evaluate(async () => {
    const store = window.qaStore;
    const key = '65:85';

    const makeMessage = (id) => ({
      id,
      rawContent: `QA message ${id}`,
      createdAt: new Date(
        Date.UTC(2026, 9, 30, 12, 0, id % 60)
      ).toISOString(),
    });

    const trials = [];

    for (let trial = 0; trial < 10; trial++) {
      await store.deleteRoomMessages(key);

      const ids = [
        1001 + trial * 10,
        1002 + trial * 10,
        1003 + trial * 10,
      ];

      const settled = await Promise.allSettled(
        ids.map(id => store.addMessages(key, [makeMessage(id)]))
      );

      const messages = await store.getRoomMessages(key);
      const savedIds = messages.map(m => Number(m.id));

      trials.push({
        trial: trial + 1,
        expected: 3,
        actual: messages.length,
        allPresent: ids.every(id => savedIds.includes(id)),
        rejectedWrites: settled.filter(
          result => result.status === 'rejected'
        ).length,
      });
    }

    await store.deleteRoomMessages(key);

    return trials;
  });

  console.log('\n=== MESSAGE CACHE CONCURRENCY REGRESSION ===');
  console.table(result);

  const passed = result.every(
    row =>
      row.actual === 3 &&
      row.allPresent &&
      row.rejectedWrites === 0
  );

  if (!passed) {
    throw new Error('Concurrent message-cache writes lost updates.');
  }

  console.log('PASS: All 30 messages retained across 10 trials.');

} catch (error) {
  console.error('FAIL:', error.stack || error.message);
  process.exitCode = 1;
} finally {
  try {
    if (browser) await browser.close();
    if (server) await server.close();
  } finally {
    if (createdFixture) {
      await unlink(fixture).catch(() => {});
    }
  }
}
