import { chromium, expect as baseExpect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const expect = baseExpect.configure({ timeout: 30000 });
export async function helperQa({
  url,
  apiUrl,
  helperUrl,
  artifacts,
  loginOnly = false,
}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const checks = [];
  const pass = (name) => {
    checks.push(name);
    console.log('PASS:', name);
  };
  await context.route('**/*', (route) =>
    [url, apiUrl].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort()
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto(helperUrl);
    const password = await page.locator('body > p > code').innerText();
    if (!loginOnly) {
      const code = page.locator('[data-account="qa_admin"] code');
      await expect(code).toHaveText(/^\d{6}$/);
      pass(
        'Actual helper renders a current qa_admin code without enrollment secrets'
      );
      await page.route('**/__synthetic/*/codes', (route) => route.abort());
      await page.getByRole('button', { name: 'Refresh codes' }).click();
      await expect(code).toHaveCount(0);
      pass('Failed refresh hides previously displayed codes');
      await page.unroute('**/__synthetic/*/codes');
      await page.getByRole('button', { name: 'Refresh codes' }).click();
      await expect(code).toHaveText(/^\d{6}$/);
      pass('Refresh restores fresh server-verified codes');
    }
    // Use the actual application sign-in, not a cookie/session injected by the harness.
    await page.goto(url);
    await expect(
      page.getByRole('button', { name: 'Log In', exact: true })
    ).toBeVisible({ timeout: 90000 });
    await page.getByLabel(/^Account/).fill('qa_admin');
    await page.getByLabel(/^Password/).fill(password);
    const loginPromise = page.waitForResponse(
      (r) =>
        r.url() === apiUrl + '/auth/login' && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    const login = await (await loginPromise).json();
    expect(login.mfaRequired).toBe(true);
    await expect(page.getByLabel('Verification code')).toBeVisible();
    pass('Real password login still requires MFA');
    async function freshCode() {
      for (let attempt = 0; attempt < 12; attempt++) {
        const result = await context.request.get(helperUrl + '/codes');
        const snapshot = await result.json();
        const value = snapshot.accounts.find(
          (a) => a.username === 'qa_admin'
        ).code;
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      throw Error('No fresh synthetic code became available');
    }
    const valid = await freshCode();
    await page
      .getByLabel('Verification code')
      .fill(valid === '000000' ? '111111' : '000000');
    const wrongPromise = page.waitForResponse(
      (r) =>
        r.url() === apiUrl + '/auth/2fa/login' &&
        r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Verify and log in' }).click();
    expect((await wrongPromise).status()).toBe(400);
    await expect(page.getByLabel('Verification code')).toBeVisible();
    pass('Invalid code is denied without bypassing MFA');
    await page.getByLabel('Verification code').fill(await freshCode());
    await page.getByRole('button', { name: 'Verify and log in' }).click();
    await expect(page.getByRole('button', { name: /log out/i })).toBeVisible();
    pass('Fresh code from actual helper completes real browser MFA');
    const csrf = await (
      await context.request.get(apiUrl + '/auth/csrf')
    ).json();
    const headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf.csrfToken || csrf.token,
    };
    const replay = await context.request.post(apiUrl + '/auth/2fa/login', {
      headers,
      data: { mfaToken: login.mfaToken, code: await freshCode() },
    });
    expect(replay.status()).toBe(401);
    pass('Completed automated challenge cannot be replayed');
    const next = await (
      await context.request.post(apiUrl + '/auth/login', {
        headers,
        data: { identifier: 'qa_admin', password },
      })
    ).json();
    const recovered = await context.request.post(apiUrl + '/auth/2fa/login', {
      headers,
      data: { mfaToken: next.mfaToken, code: await freshCode() },
    });
    expect(recovered.status()).toBe(200);
    pass(
      'New independent challenge succeeds after automated login; no shared challenge reuse'
    );
  } catch (error) {
    console.error('Helper check failed at URL', page.url(), error.message);
    throw error;
  } finally {
    writeFileSync(
      loginOnly
        ? '/tmp/chatforia-staff-helper-login-report.json'
        : '/tmp/chatforia-staff-helper-report.json',
      JSON.stringify(
        {
          checks,
          artifacts,
          loginOnly,
          completed: checks.length === (loginOnly ? 5 : 8),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    await browser.close();
  }
}
