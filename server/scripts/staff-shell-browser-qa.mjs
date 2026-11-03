import { chromium, expect as baseExpect } from '@playwright/test';
import speakeasy from 'speakeasy';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const expect = baseExpect.configure({ timeout: 30000 });
export async function browserQa({
  url,
  apiUrl,
  password,
  secrets,
  artifacts,
  admin,
  codeFor,
  tailOnly = false,
}) {
  const checks = [];
  const pass = (name) => {
    checks.push(name);
    console.log('PASS:', name);
  };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  await context.route('**/*', (route) =>
    [url, apiUrl].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort()
  );
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function login(username) {
    await page.goto(url);
    await page.getByLabel(/^Account/).fill(username);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    await expect(page.getByLabel('Verification code')).toBeVisible();
    pass(`${username}: real password requires MFA before session`);
    await page.getByLabel('Verification code').fill(
      codeFor
        ? await codeFor(username)
        : speakeasy.totp({
            secret: secrets.get(username),
            encoding: 'base32',
          })
    );
    await page.getByRole('button', { name: 'Verify and log in' }).click();
    await expect(page.getByRole('button', { name: /log out/i })).toBeVisible({
      timeout: 30000,
    });
  }
  try {
    await page.goto(url + '/admin/users');
    await expect(
      page.getByRole('button', { name: 'Log In', exact: true })
    ).toBeVisible({ timeout: 60000 });
    pass('Anonymous protected deep link routes to actual login');
    await login('qa_admin');
    if (!tailOnly) {
      await page.goto(url + '/admin/users');
      const row = page.locator('[data-user-id="100"]');
      await expect(row).toBeVisible({ timeout: 30000 });
      pass('Real UserContext bootstrap and admin routing survive page reload');
      await row.getByRole('button', { name: 'View', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText(
        /Synthetic ordinary user|Full shell saved/
      );
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      pass('Full shell selected-user View loads permitted details');
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      await page
        .getByLabel('Display name', { exact: true })
        .fill('Cancelled shell value');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(row).not.toContainText('Cancelled shell value');
      pass('Full shell Cancel preserves record');
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      await page
        .getByLabel('Display name', { exact: true })
        .fill('Full shell saved');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      pass('Required change reason prevents invalid save');
      await page
        .getByLabel('Change reason')
        .fill('Synthetic full shell acceptance');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(row).toContainText('Full shell saved');
      if (admin) {
        const saved = await admin.user.findUnique({ where: { id: 100 } });
        expect(saved.displayName).toBe('Full shell saved');
      }
      pass('Real protected API save updates database and displayed record');
    }
    await page.getByRole('button', { name: /log out/i }).click();
    await expect(
      page.getByRole('button', { name: 'Log In', exact: true })
    ).toBeVisible();
    pass('Logout clears UserContext and protected shell');
    await login('qa_user');
    await page.goto(url + '/admin/users');
    await expect(page.locator('[data-user-id="100"]')).not.toBeVisible();
    const denied = await context.request.get(apiUrl + '/admin/users');
    expect(denied.status()).toBe(403);
    pass('Ordinary MFA account denied by routing and actual admin API');
    await page.screenshot({ path: join(artifacts, 'shell-final.png') });
  } catch (error) {
    await page
      .screenshot({ path: join(artifacts, 'shell-failure.png') })
      .catch(() => {});
    writeFileSync(
      join(artifacts, 'shell-failure.txt'),
      await page.locator('body').innerText()
    );
    throw error;
  } finally {
    writeFileSync(
      '/tmp/chatforia-staff-shell-report.json',
      JSON.stringify(
        {
          checks,
          errors,
          artifacts,
          tailOnly,
          completed: checks.length === (tailOnly ? 5 : 10),
        },
        null,
        2
      )
    );
    await browser.close();
  }
}
