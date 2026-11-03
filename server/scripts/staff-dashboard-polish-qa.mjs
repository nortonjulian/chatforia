import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 60000 });
const session = JSON.parse(
  readFileSync('/tmp/chatforia-staff-shell-session.json', 'utf8')
);
assert.equal(session.syntheticOnly, true);
assert.equal(new URL(session.url).hostname, 'localhost');
assert.equal(new URL(session.apiUrl).hostname, 'localhost');
assert.equal(
  JSON.parse(
    readFileSync(join(session.artifacts, 'synthetic-only.json'), 'utf8')
  ).pid,
  session.pid
);
const { url, apiUrl, helperUrl, artifacts } = session;
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS:', name);
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function login(username) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.route('**/*', (r) =>
    [url, apiUrl].includes(new URL(r.request().url()).origin)
      ? r.continue()
      : r.abort()
  );
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const html = await (await context.request.get(helperUrl)).text();
  const password = html.match(/accounts: <code>([^<]+)/)[1];
  await page.goto(url);
  await expect(
    page.getByRole('button', { name: 'Log In', exact: true })
  ).toBeVisible();
  await page.getByLabel(/^Account/).fill(username);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByLabel('Verification code')).toBeVisible();
  let code;
  for (let n = 0; n < 12 && !code; n++) {
    const snapshot = await (
      await context.request.get(helperUrl + '/codes')
    ).json();
    code = snapshot.accounts.find((a) => a.username === username).code;
    if (!code) await new Promise((resolve) => setTimeout(resolve, 600));
  }
  assert.ok(code);
  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Verify and log in' }).click();
  await expect(page.getByRole('button', { name: /log out/i })).toBeVisible();
  return { page, context };
}
try {
  if (!process.argv.includes('--staff-layout-only')) {
    const { page, context } = await login('qa_admin');
    await page.goto(url + '/admin/users');
    const row = page.locator('[data-user-id="100"]');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'View', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('English');
    await expect(dialog).not.toContainText('true');
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() =>
        globalThis.document
          .querySelector('dialog')
          .contains(globalThis.document.activeElement)
      ),
      true
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await page.evaluate(() =>
        globalThis.document
          .querySelector('dialog')
          .contains(globalThis.document.activeElement)
      ),
      true
    );
    await page.keyboard.press('Escape');
    await expect(
      row.getByRole('button', { name: 'View', exact: true })
    ).toBeFocused();
    pass(
      'Friendly View values, native focus trap, Escape and opener restoration'
    );
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const name = page.getByLabel('Display name', { exact: true });
    await expect(name).toBeVisible();
    const original = await name.inputValue();
    assert.equal(
      await dialog
        .locator('dl')
        .innerText()
        .then((t) => t.includes('Display name')),
      false
    );
    await name.fill('Cancelled polish');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      row.getByRole('button', { name: 'Edit', exact: true })
    ).toBeFocused();
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(name).toHaveValue(original);
    await name.fill('Synthetic polished preference');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeVisible();
    await page
      .getByLabel('Change reason', { exact: true })
      .fill('Synthetic UI polish verification');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toContainText('Synthetic polished preference');
    pass(
      'No duplicate Edit summaries; cancel, required reason, save and row refresh'
    );
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(name).toHaveValue('Synthetic polished preference');
    await name.fill(original);
    await page
      .getByLabel('Change reason', { exact: true })
      .fill('Restore prior synthetic display value');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).not.toBeVisible();
    const protectedRow = page.locator('[data-user-id="3"]');
    await expect(protectedRow).toContainText('USER');
    await protectedRow
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    await expect(dialog).toContainText('identity is protected');
    await expect(
      page.getByRole('button', { name: 'Save changes' })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(
      protectedRow.getByRole('button', { name: 'Edit', exact: true })
    ).toBeDisabled();
    await expect(
      protectedRow.getByRole('button', { name: 'View', exact: true })
    ).toBeFocused();
    pass(
      'Server-authoritative protection disables Edit for staff with displayed USER role; focus falls back to View'
    );
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: join(artifacts, `polish-admin-${width}.png`),
        fullPage: true,
      });
      await row.getByRole('button', { name: 'View', exact: true }).click();
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await page.screenshot({
        path: join(artifacts, `polish-dialog-${width}.png`),
      });
      await page.keyboard.press('Escape');
    }
    pass('Admin table and rounded dialog fit desktop/narrow viewport');
    await context.close();
  }
  const staff = await login('qa_support');
  await staff.page.goto(url + '/staff');
  await expect(
    staff.page.getByRole('button', { name: 'Users', exact: true })
  ).toBeVisible();
  await expect(staff.page.locator('table tbody tr').first()).toBeVisible();
  await staff.page
    .getByRole('button', { name: 'Reports', exact: true })
    .click();
  await expect(
    staff.page.getByText('No records.', { exact: true })
  ).toBeVisible();
  await staff.page.getByRole('button', { name: 'Users', exact: true }).click();
  await expect(staff.page.locator('table tbody tr').first()).toBeVisible();
  await staff.page
    .locator('table tbody tr')
    .filter({ hasText: 'qa_user' })
    .getByRole('button', { name: 'View', exact: true })
    .click();
  await expect(staff.page.getByRole('dialog')).toContainText('English');
  await expect(
    staff.page.getByRole('button', { name: 'Save changes' })
  ).toHaveCount(0);
  await staff.page.getByRole('button', { name: 'Close', exact: true }).click();
  for (const width of [1280, 390]) {
    await staff.page.setViewportSize({ width, height: 900 });
    const main = staff.page.locator('main.cf-dashboard');
    const b = await main.boundingBox();
    const parent = await main.evaluate(
      (el) => el.parentElement.getBoundingClientRect().top
    );
    assert.ok(b.y - parent < 40);
    const plain = await main
      .locator('button')
      .evaluateAll(
        (nodes) =>
          nodes.filter((n) => !n.classList.contains('cf-dashboard-button'))
            .length
      );
    assert.equal(plain, 0);
    await expect(
      staff.page.getByRole('button', { name: 'Previous', exact: true })
    ).toBeDisabled();
    await expect(
      staff.page.getByRole('button', { name: 'Next', exact: true })
    ).toBeDisabled();
    await staff.page.screenshot({
      path: join(artifacts, `polish-staff-${width}.png`),
      fullPage: true,
    });
  }
  pass(
    'Staff tabs, read-only View, pagination, branded buttons and top-aligned desktop/narrow layouts'
  );
  await staff.context.close();
} finally {
  writeFileSync(
    process.argv.includes('--staff-layout-only')
      ? '/tmp/chatforia-dashboard-layout-report.json'
      : '/tmp/chatforia-dashboard-polish-report.json',
    JSON.stringify(
      {
        checks,
        artifacts,
        completed:
          checks.length ===
          (process.argv.includes('--staff-layout-only') ? 1 : 5),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  await browser.close();
}
