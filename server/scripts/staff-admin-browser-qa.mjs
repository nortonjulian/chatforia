import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function adminBrowserQa({ pageFor, admin, pass }) {
  const page = await pageFor(19, 0, true, false, '/qa-admin-users');
  const row = page.locator('[data-user-id="100"]');
  await row.waitFor({ state: 'attached' });
  await row.scrollIntoViewIfNeeded();
  await expect(
    row.getByRole('button', { name: 'View', exact: true })
  ).toBeVisible();
  await row.getByRole('button', { name: 'View', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('User details #100');
  await expect(
    dialog.getByText('Current user display', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Save changes' })
  ).toHaveCount(0);
  const exposed = await (
    await page.request.get(new URL('/admin/users/100', page.url()).href)
  ).json();
  assert.ok(
    !/passwordHash|totpSecretEnc|recoveryToken|googleSub|appleSub|tokenVersion/.test(
      JSON.stringify(exposed)
    )
  );
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  pass(
    'Chromium Users View opens selected current details without credentials, MFA secrets or recovery material'
  );

  async function edit() {
    await row.scrollIntoViewIfNeeded();
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(
      dialog.getByLabel('Display name', { exact: true })
    ).toHaveValue(
      (await admin.user.findUnique({ where: { id: 100 } })).displayName
    );
    return dialog;
  }
  await edit();
  await dialog
    .getByLabel('Display name', { exact: true })
    .fill('Cancelled name');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(
    (await admin.user.findUnique({ where: { id: 100 } })).displayName,
    'Current user display'
  );
  assert.equal(
    await admin.auditLog.count({
      where: { action: 'ADMIN_USER_PREFERENCES_UPDATED', resourceId: '100' },
    }),
    0
  );
  pass(
    'Chromium Users Edit loads current values; Cancel makes no request-backed change or audit'
  );

  await edit();
  await dialog.getByLabel('Display name', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByLabel('Preferred language', { exact: true })
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByLabel('Display name', { exact: true })
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    row.getByRole('button', { name: 'Edit', exact: true })
  ).toBeFocused();
  assert.equal(
    (await admin.user.findUnique({ where: { id: 100 } })).displayName,
    'Current user display'
  );
  pass(
    'Chromium Users dialog keyboard navigation works, Escape cancels and returns focus to Edit'
  );

  await edit();
  await dialog
    .getByLabel('Preferred language', { exact: true })
    .fill('bad locale');
  await dialog
    .getByLabel('Change reason', { exact: true })
    .fill('Synthetic browser validation');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByRole('alert')).toContainText('valid language tag');
  assert.equal(
    (await admin.user.findUnique({ where: { id: 100 } })).preferredLanguage,
    'en'
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  pass(
    'Chromium Users Edit displays server validation errors without changing the record'
  );

  await edit();
  // Synthetic independent writer changes the preference tuple after form load.
  await admin.user.update({
    where: { id: 100 },
    data: { preferredLanguage: 'fr' },
  });
  await dialog
    .getByLabel('Display name', { exact: true })
    .fill('Stale browser name');
  await dialog
    .getByLabel('Change reason', { exact: true })
    .fill('Synthetic concurrent edit conflict');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByRole('alert')).toContainText('User values changed');
  assert.equal(
    (await admin.user.findUnique({ where: { id: 100 } })).preferredLanguage,
    'fr'
  );
  assert.equal(
    (await admin.user.findUnique({ where: { id: 100 } })).displayName,
    'Current user display'
  );
  assert.equal(
    await admin.auditLog.count({
      where: { action: 'ADMIN_USER_PREFERENCES_UPDATED' },
    }),
    0
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await admin.user.update({
    where: { id: 100 },
    data: { preferredLanguage: 'en' },
  });
  pass(
    'Chromium Users Edit rejects a concurrent preference change without overwrite or success audit'
  );

  await edit();
  await dialog
    .getByLabel('Display name', { exact: true })
    .fill('Browser saved name');
  await dialog.getByLabel('Preferred language', { exact: true }).fill('es');
  await dialog.getByLabel('Read receipts', { exact: true }).uncheck();
  await dialog
    .getByLabel('Change reason', { exact: true })
    .fill('Synthetic authorized user preference edit');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    row.getByText('Browser saved name', { exact: true })
  ).toBeVisible();
  const saved = await admin.user.findUnique({ where: { id: 100 } });
  assert.equal(saved.displayName, 'Browser saved name');
  assert.equal(saved.preferredLanguage, 'es');
  assert.equal(saved.showReadReceipts, false);
  assert.equal(
    await admin.auditLog.count({
      where: {
        action: 'ADMIN_USER_PREFERENCES_UPDATED',
        resourceId: '100',
        actorId: 19,
      },
    }),
    1
  );
  pass(
    'Chromium Users Edit saves only authorized preferences, refreshes the list and creates one mandatory audit'
  );

  const patch = (id, body) =>
    page.evaluate(
      async ({ id, body }) => {
        const csrf = decodeURIComponent(
          globalThis.document.cookie.match(
            /(?:^|;\s*)XSRF-TOKEN=([^;]+)/
          )?.[1] || ''
        );
        return (
          await fetch(`/admin/users/${id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf,
            },
            body: JSON.stringify(body),
          })
        ).status;
      },
      { id, body }
    );
  const latest = await (
    await page.request.get(new URL('/admin/users/100', page.url()).href)
  ).json();
  assert.equal(
    await patch(100, {
      changes: { role: 'ADMIN' },
      version: latest.version,
      reason: 'Forged role change rejected',
    }),
    400
  );
  assert.equal(
    (await admin.user.findUnique({ where: { id: 100 } })).role,
    'USER'
  );
  for (const id of [13, 16, 19]) {
    const protectedRow = page.locator(`[data-user-id="${id}"]`);
    await protectedRow.scrollIntoViewIfNeeded();
    await protectedRow
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    await expect(
      page
        .getByRole('dialog')
        .getByText(
          'This identity is protected or your permission is read-only. Editing is unavailable.'
        )
    ).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Save changes' })
    ).toHaveCount(0);
    const protectedDetails = await (
      await page.request.get(new URL(`/admin/users/${id}`, page.url()).href)
    ).json();
    assert.equal(
      await patch(id, {
        changes: { displayName: 'forged' },
        version: protectedDetails.version,
        reason: 'Protected identity rejection',
      }),
      403
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
  }
  pass(
    'Chromium Users Edit rejects role escalation and founder, staff and administrator identity edits on the server'
  );

  const denied = await pageFor(16, 5, true, false, '/qa-admin-users');
  await expect(denied.getByRole('alert')).toContainText('not authorized');
  await expect(
    denied.getByRole('button', { name: 'View', exact: true })
  ).toHaveCount(0);
  const noMfa = await pageFor(19, 0, false, false, '/qa-admin-users');
  await expect(noMfa.getByRole('alert')).toContainText('not authorized');
  pass(
    'Chromium Users list and buttons deny staff-only and unverified-MFA administrator sessions'
  );

  await edit();
  await dialog
    .getByLabel('Display name', { exact: true })
    .fill('Denied stale-session save');
  await dialog
    .getByLabel('Change reason', { exact: true })
    .fill('Session loss must prevent saving');
  await admin.user.update({
    where: { id: 19 },
    data: { tokenVersion: { increment: 1 } },
  });
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Save changes' })
  ).toHaveCount(0);
  assert.equal(
    (await admin.user.findUnique({ where: { id: 100 } })).displayName,
    'Browser saved name'
  );
  assert.equal(
    await admin.auditLog.count({
      where: { action: 'ADMIN_USER_PREFERENCES_UPDATED', resourceId: '100' },
    }),
    1
  );
  pass(
    'Chromium Users Edit rejects a session lost after loading and removes save controls without modifying data'
  );
}
