import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { chromium, expect } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';

export async function browserQa({ runtime, admin, artifacts, pass }) {
  const { createStaffRouter } = await import('../routes/staff.js');
  const { requireAuth, requireAdmin } = await import('../middleware/auth.js');
  const { createAdminUsersReadOnlyRouter } = await import(
    '../routes/adminUsersReadOnly.js'
  );
  const { createAdminUserDetailsRouter } = await import(
    '../routes/adminUserDetails.js'
  );
  const { buildCsrf, csrfOnlyForCookieAuth } = await import(
    '../middleware/csrf.js'
  );
  const { createMfaChallenge, completeMfaChallenge } = await import(
    '../services/mfaLogin.js'
  );
  const { default: speakeasy } = await import('speakeasy');
  const vite = await createViteServer({
    configFile: false,
    cacheDir: join(artifacts, 'vite-cache'),
    root: join(process.cwd(), 'client'),
    envDir: false,
    resolve: {
      alias: { '@': join(process.cwd(), 'client/src') },
      dedupe: ['react', 'react-dom', '@mantine/core', '@mantine/hooks'],
    },
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
      include: ['react', 'react-dom/client', 'axios', '@mantine/core'],
    },
    plugins: [
      react(),
      {
        name: 'staff-qa-entry',
        resolveId: (id) =>
          id === '/@staff-qa-entry.jsx' ? '\0staff-qa-entry.jsx' : undefined,
        load: (id) =>
          id === '\0staff-qa-entry.jsx'
            ? `import React from 'react'; import {createRoot} from 'react-dom/client'; import StaffDashboard from '/src/pages/StaffDashboard.jsx'; import UsersTable from '/src/components/admin/UsersTable.jsx'; import {MantineProvider} from '@mantine/core'; import '@mantine/core/styles.css'; createRoot(globalThis.document.getElementById('root')).render(React.createElement(MantineProvider, null, React.createElement(location.pathname === '/qa-admin-users' ? UsersTable : StaffDashboard)));`
            : undefined,
      },
    ],
    server: {
      middlewareMode: true,
      hmr: false,
      fs: { allow: [process.cwd()] },
    },
  });
  const app = express();
  app.use(
    express.json(),
    cookieParser(),
    csrfOnlyForCookieAuth(buildCsrf({ isProd: false }))
  );
  app.get(['/staff', '/qa-admin-users'], async (_req, res, next) => {
    try {
      res
        .type('html')
        .send(
          await vite.transformIndexHtml(
            '/staff',
            '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated staff QA</title></head><body><div id="root"></div><script>window.__API_URL__=location.origin</script><script type="module" src="/@staff-qa-entry.jsx"></script></body></html>'
          )
        );
    } catch (error) {
      next(error);
    }
  });
  app.get('/auth/csrf', (req, res) => {
    const csrfToken = req.csrfToken();
    res.cookie('XSRF-TOKEN', csrfToken, { sameSite: 'lax', path: '/' });
    res.json({ csrfToken });
  });
  const adminOptions = {
    db: runtime,
    authenticate: (req, res, next) => requireAuth(req, res, next, runtime),
    authorize: requireAdmin,
  };
  app.use(
    '/admin/users',
    createAdminUsersReadOnlyRouter(adminOptions),
    createAdminUserDetailsRouter(adminOptions)
  );
  app.use(
    '/staff',
    createStaffRouter({
      db: runtime,
      authenticate: (req, res, next) => requireAuth(req, res, next, runtime),
    })
  );
  app.use(vite.middlewares);
  app.use((error, _req, res, _next) =>
    res
      .status(error.code === 'EBADCSRFTOKEN' ? 403 : 500)
      .json({ error: 'Request rejected' })
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors = [],
    external = [],
    pages = [];
  const screenshots = [];
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      timeout: 15000,
    });
    async function pageFor(
      id,
      version,
      mfa = true,
      mobile = false,
      path = '/staff'
    ) {
      const context = await browser.newContext({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1280, height: 900 },
      });
      await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin)
          return route.continue();
        external.push(new URL(route.request().url()).origin);
        return route.abort();
      });
      if (id)
        await context.addCookies([
          {
            name: 'foria_jwt',
            value: jwt.sign(
              { id, tokenVersion: version, mfaVerified: mfa, typ: 'session' },
              process.env.JWT_SECRET,
              { expiresIn: '10m', algorithm: 'HS256' }
            ),
            url: origin,
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]);
      context.setDefaultTimeout(10000);
      const page = await context.newPage();
      pages.push(page);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${origin}${path}`, { timeout: 15000 });
      return page;
    }
    const anonymous = await pageFor();
    await expect(anonymous.getByRole('alert')).toContainText(
      'MFA-verified session'
    );
    await expect(anonymous.getByRole('navigation')).toHaveCount(0);
    const noMfa = await pageFor(17, 0, false);
    await expect(noMfa.getByRole('alert')).toBeVisible();
    pass(
      'Chromium: anonymous and non-MFA sessions cannot display staff data or controls'
    );

    const support = await pageFor(16, 5, true, true);
    await expect(
      support.getByRole('button', { name: 'Users', exact: true })
    ).toBeVisible();
    await expect(
      support.getByRole('button', { name: 'Staff access', exact: true })
    ).toHaveCount(0);
    await expect(
      support.getByRole('cell', {
        name: '<img src=x onerror="window.__staffXss=1">',
        exact: true,
      })
    ).toBeVisible();
    assert.equal(
      await support.evaluate(() => globalThis.__staffXss),
      undefined
    );
    assert.equal(await support.locator('table img').count(), 0);
    const nextPage = support.waitForResponse(
      (response) =>
        response.url().includes('/staff/users?') &&
        new URL(response.url()).searchParams.get('skip') === '25'
    );
    await support.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await nextPage).status(), 200);
    await expect(
      support.getByRole('button', { name: 'Previous', exact: true })
    ).toBeEnabled();
    await support
      .getByRole('button', { name: 'Previous', exact: true })
      .click();
    assert.ok(
      await support.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth
      ),
      'Mobile document should not overflow horizontally'
    );
    const mobileShot = join(artifacts, 'staff-support-mobile.png');
    await support.screenshot({ path: mobileShot, fullPage: true });
    screenshots.push(mobileShot);
    pass(
      'Chromium mobile: permission-filtered navigation, paginated users, escaped text and bounded layout'
    );

    await support
      .getByRole('button', { name: 'View', exact: true })
      .first()
      .click();
    await expect(
      support
        .getByRole('dialog')
        .getByText('<img src=x onerror="window.__staffXss=1">', { exact: true })
    ).toBeVisible();
    await expect(
      support.getByRole('dialog').getByRole('button', { name: 'Save changes' })
    ).toHaveCount(0);
    await support
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    pass(
      'Chromium staff View opens permitted details without giving read-only staff editing controls'
    );

    await support.getByRole('button', { name: 'Reports', exact: true }).click();
    await support.getByLabel('Report ID', { exact: true }).fill('28');
    await support
      .getByLabel('Resolution reason', { exact: true })
      .fill('Synthetic browser report verification');
    await support
      .getByRole('button', { name: 'Resolve report', exact: true })
      .click();
    await expect(
      support.getByRole('status').filter({ hasText: 'Report 28 resolved.' })
    ).toBeVisible();
    assert.equal(
      (await admin.report.findUnique({ where: { id: 28 } })).status,
      'RESOLVED'
    );
    assert.equal(
      await admin.auditLog.count({
        where: { action: 'REPORT_RESOLVED', resourceId: '28' },
      }),
      1
    );
    assert.equal(
      await support.evaluate(async () => (await fetch('/staff/audit')).status),
      403
    );
    pass(
      'Chromium: real cookie/CSRF report resolution creates its audit and rejects unauthorized audit access'
    );

    const { adminBrowserQa } = await import('./staff-admin-browser-qa.mjs');
    await adminBrowserQa({ pageFor, admin, pass });
    const cto = await pageFor(14, 0);
    await cto
      .getByRole('button', { name: 'Access audit', exact: true })
      .click();
    await expect(cto.getByText('No records.', { exact: true })).toBeVisible();
    pass(
      'Chromium: authorized empty audit view renders without exposing unrelated records'
    );

    const revoked = await pageFor(18, 2);
    await expect(
      revoked.getByRole('button', { name: 'Users', exact: true })
    ).toBeVisible();
    const manager = await pageFor(17, 0);
    await expect(
      manager.getByRole('heading', { name: 'Manage staff access' })
    ).toBeVisible();
    const profiles = manager.getByRole('combobox');
    await expect(profiles.locator('option')).toHaveText([
      'SENIOR ENGINEER',
      'SUPPORT',
    ]);
    await manager.getByLabel('User ID', { exact: true }).fill('-1');
    await manager
      .getByLabel('Reason', { exact: true })
      .fill('Synthetic browser profile change');
    assert.equal(
      await manager
        .getByLabel('User ID', { exact: true })
        .evaluate((element) => element.checkValidity()),
      false
    );
    await manager.getByLabel('User ID', { exact: true }).fill('16');
    await profiles.selectOption('SENIOR_ENGINEER');
    let release, intercepted;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const paused = new Promise((resolve) => {
      intercepted = resolve;
    });
    await manager.route('**/staff/assignments/16/grant', async (route) => {
      intercepted();
      await gate;
      await route.continue();
    });
    await manager
      .getByRole('button', { name: 'Grant or change access' })
      .click();
    let pauseTimer;
    try {
      await Promise.race([
        paused,
        new Promise((_, reject) => {
          pauseTimer = setTimeout(
            () => reject(new Error('Grant request was not issued')),
            10000
          );
        }),
      ]);
      await expect(
        manager.getByRole('button', { name: 'Grant or change access' })
      ).toBeDisabled();
      await expect(
        manager.getByRole('button', { name: 'Revoke access' })
      ).toBeDisabled();
    } finally {
      clearTimeout(pauseTimer);
      release();
    }
    await expect(
      manager
        .getByRole('status')
        .filter({ hasText: 'Access updated for user 16.' })
    ).toBeVisible();
    const assigned = await admin.staffAssignment.findUnique({
      where: { userId: 16 },
    });
    assert.equal(assigned.profile, 'SENIOR_ENGINEER');
    assert.equal(
      (await admin.user.findUnique({ where: { id: 16 } })).tokenVersion,
      6
    );
    const desktopShot = join(artifacts, 'staff-access-desktop.png');
    await manager.screenshot({ path: desktopShot, fullPage: true });
    screenshots.push(desktopShot);
    pass(
      'Chromium: profile scope, native ID validation, disabled pending controls and real audited grant'
    );

    await manager.getByLabel('User ID', { exact: true }).fill('18');
    await manager
      .getByLabel('Reason', { exact: true })
      .fill('Synthetic browser revocation');
    await manager.getByRole('button', { name: 'Revoke access' }).click();
    await expect(
      manager
        .getByRole('status')
        .filter({ hasText: 'Access revoked for user 18.' })
    ).toBeVisible();
    assert.equal(
      (await admin.staffAssignment.findUnique({ where: { userId: 18 } }))
        .active,
      false
    );
    await revoked.getByRole('button', { name: 'Reports', exact: true }).click();
    await expect(revoked.getByRole('alert')).toContainText(
      'Staff access is unavailable'
    );
    await expect(revoked.getByRole('navigation')).toHaveCount(0);
    pass(
      'Chromium: real revocation invalidates the existing browser session and removes protected UI'
    );

    process.env.STAFF_DASHBOARD_ENABLED = 'false';
    await manager.reload();
    await expect(manager.getByRole('alert')).toBeVisible();
    await expect(
      manager.getByRole('heading', { name: 'Manage staff access' })
    ).toHaveCount(0);
    const user = await runtime.user.findUnique({ where: { id: 17 } });
    const challenge = await createMfaChallenge(user, null, runtime);
    assert.equal(
      (
        await completeMfaChallenge(
          challenge,
          speakeasy.totp({
            secret: process.env.STAFF_QA_TOTP,
            encoding: 'base32',
          }),
          runtime
        )
      ).ok,
      true
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    pass(
      'Chromium: dashboard kill switch preserves protected MFA; no page errors or external requests'
    );
    return {
      engine: 'Chromium (Chrome)',
      version: browser.version(),
      screenshots,
      pageErrors: errors.length,
      externalRequests: external.length,
    };
  } catch (error) {
    writeFileSync(
      join(artifacts, 'browser-page-errors.json'),
      JSON.stringify(errors, null, 2),
      { mode: 0o600 }
    );
    if (pages.length)
      writeFileSync(
        join(artifacts, 'browser-failure.html'),
        await pages.at(-1).content(),
        { mode: 0o600 }
      );
    if (pages.length)
      await pages
        .at(-1)
        .screenshot({
          path: join(artifacts, 'browser-failure.png'),
          fullPage: true,
        })
        .catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    await vite.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
