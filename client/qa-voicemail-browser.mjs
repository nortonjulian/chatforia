import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:5198';
const accounts = {
  A: {
    id: 101, username: 'voicemail_qa_a', plan: 'PLUS',
    canForwardVoicemailEmail: true, voicemailEnabled: true,
    voicemailEmailForwardingEnabled: true,
    voicemailForwardEmail: 'first@example.test',
    voicemailGreetingText: 'First account greeting',
  },
  B: {
    id: 202, username: 'voicemail_qa_b', plan: 'PLUS',
    canForwardVoicemailEmail: true, voicemailEnabled: true,
    voicemailEmailForwardingEnabled: false,
    voicemailForwardEmail: 'second@example.test',
    voicemailGreetingText: 'Second account greeting',
  },
};
let selected = 'A';
const patches = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.setDefaultTimeout(5000);
const externalRequests = [];
page.on('pageerror', (error) => console.error('Browser page error:', error.message));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Warning:')) console.error('Browser console error:', message.text()); });
await page.addInitScript(() => { window.__API_URL__ = location.origin; });
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) {
    externalRequests.push(request.url());
    return route.abort();
  }
  if (url.pathname === '/qa/voicemail-account') {
    console.log('mock account read', url.searchParams.get('account'));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(accounts[url.searchParams.get('account')]) });
  }
  if (url.pathname === '/auth/csrf') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'synthetic-csrf' }) });
  }
  if (url.pathname === '/users/me' && request.method() === 'PATCH') {
    const payload = request.postDataJSON();
    patches.push({ selected, payload });
    accounts[selected] = { ...accounts[selected], ...payload };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(accounts[selected]) });
  }
  if (url.pathname === '/billing/my-plan') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: { name: 'PLUS' } }) });
  }
  if (/^\/(?:api|auth|billing|users|devices|follows)\//.test(url.pathname)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  }
  return route.continue();
});

try {
  await page.goto(`${origin}/qa-voicemail.html`);
  await page.getByText('Synthetic account A').waitFor();
  console.log('loaded account A');
  await page.getByLabel('Forwarding email address').waitFor();
  console.log('found email field');
  assert.equal(await page.getByLabel('Forwarding email address').inputValue(), 'first@example.test');
  assert.equal(await page.getByLabel('Forward voicemail to email').isChecked(), true);
  await page.getByLabel('Forwarding email address').fill('saved@example.test');
  console.log('filled email');
  const savedResponse = page.waitForResponse((response) => response.url().endsWith('/users/me') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save profile' }).click();
  console.log('clicked save');
  await savedResponse;
  assert.equal(patches.length, 1);
  assert.equal(patches[0].payload.voicemailForwardEmail, 'saved@example.test');
  await page.screenshot({ path: '/private/tmp/chatforia-voicemail-web-saved-20261111.png', fullPage: true });

  await page.reload();
  await page.getByText('Synthetic account A').waitFor();
  assert.equal(await page.getByLabel('Forwarding email address').inputValue(), 'saved@example.test');
  selected = 'B';
  await page.evaluate(() => window.qaSwitchVoicemailAccount('B'));
  await page.getByText('Synthetic account B').waitFor();
  assert.equal(await page.getByLabel('Forwarding email address').inputValue(), 'second@example.test');
  assert.equal(await page.getByLabel('Forward voicemail to email').isChecked(), false);
  await page.screenshot({ path: '/private/tmp/chatforia-voicemail-web-account-b-20261111.png', fullPage: true });
  assert.equal(externalRequests.length, 0);
  console.log('PASS Chrome UI: save, reopen, and account isolation with synthetic settings; external requests blocked');
  console.log(`Mock PATCH count: ${patches.length}`);
} finally {
  await browser.close();
}
