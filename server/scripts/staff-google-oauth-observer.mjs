import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { writeFileSync } from 'node:fs';

// Only installed by the new-cluster harness. These are fixture/observation routes,
// never production API routes. No application auth response is replaced or mocked.
export function installGoogleObserver({
  web,
  helper,
  admin,
  apiUrl,
  qaEmail,
  artifacts,
}) {
  let prepared = false,
    logoutObserved = false;
  const evidence = {
    realGoogle: false,
    syntheticOnly: true,
    artifacts,
    preMfaDenied: false,
    postMfaSupport: false,
    adminDenied: false,
    logoutDenied: false,
  };
  function save() {
    writeFileSync(
      '/tmp/chatforia-google-oauth-report.json',
      JSON.stringify(
        {
          ...evidence,
          completed:
            evidence.preMfaDenied &&
            evidence.postMfaSupport &&
            evidence.adminDenied &&
            evidence.logoutDenied,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  }
  web.post(helper + '/prepare-support', async (req, res) => {
    if (req.get('origin') !== new URL(apiUrl).origin.replace(':5002', ':5173'))
      return res.sendStatus(403);
    try {
      if (!prepared)
        await admin.$transaction(async (tx) => {
          const user = await tx.user.findUnique({ where: { id: 3 } });
          if (
            !evidence.realGoogle ||
            !user?.googleSub ||
            user.email !== qaEmail ||
            user.role !== 'USER' ||
            !user.twoFactorEnabled
          )
            throw Error('First Google callback must link the ordinary fixture');
          await tx.user.update({
            where: { id: 3 },
            data: { tokenVersion: { increment: 1 } },
          });
          await tx.staffAssignment.create({
            data: {
              userId: 3,
              profile: 'SUPPORT',
              grantedById: 1,
              active: true,
            },
          });
        });
      prepared = true;
      res.json({
        prepared: true,
        next: 'Discard the first MFA challenge. Start Google sign-in again, then Check current access before entering the new MFA code.',
      });
    } catch {
      res.status(409).json({
        prepared: false,
        next: 'Finish the first Google callback with the configured QA account, stop at Chatforia MFA, then retry Prepare Support.',
      });
    }
  });
  web.get(helper + '/check', async (req, res) => {
    try {
      const headers = {
        cookie: req.headers.cookie || '',
        'X-Requested-With': 'XMLHttpRequest',
      };
      const staff = await fetch(apiUrl + '/staff/session', {
        headers,
        redirect: 'manual',
      });
      const administrator = await fetch(apiUrl + '/admin/users', {
        headers,
        redirect: 'manual',
      });
      const me = await fetch(apiUrl + '/auth/me', {
        headers,
        redirect: 'manual',
      });
      const user = await admin.user.findUnique({
        where: { id: 3 },
        select: { googleSub: true, twoFactorEnabled: true, tokenVersion: true },
      });
      const staffBody = staff.ok ? await staff.json() : null;
      let authenticated = false,
        mfaPagePending = false;
      if (me.ok) {
        const payload = await me.json();
        authenticated = (payload.user || payload)?.id === 3;
      }
      mfaPagePending = Boolean(
        req.cookies?.cf_mfa_pending ||
          /(?:^|;\s*)cf_mfa_pending=/.test(req.headers.cookie || '')
      );
      let validCurrentChallenge = false;
      try {
        const raw = (req.headers.cookie || '').match(
          /(?:^|;\s*)cf_mfa_pending=([^;]+)/
        )?.[1];
        const claims = jwt.verify(
          decodeURIComponent(raw || ''),
          process.env.JWT_SECRET,
          { algorithms: ['HS256'] }
        );
        if (
          claims.typ === 'mfa' &&
          claims.sub === '3' &&
          claims.tokenVersion === user.tokenVersion
        ) {
          const record = await admin.verificationToken.findFirst({
            where: {
              userId: 3,
              tokenHash: createHash('sha256').update(claims.jti).digest('hex'),
              usedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
          validCurrentChallenge = Boolean(record);
        }
      } catch {
        /* Invalid/old challenge is never counted as the pre-MFA test. */
      }
      if (
        prepared &&
        user?.googleSub &&
        validCurrentChallenge &&
        staff.status === 401 &&
        administrator.status === 401
      )
        evidence.preMfaDenied = true;
      if (
        prepared &&
        authenticated &&
        staff.status === 200 &&
        staffBody?.profile === 'SUPPORT'
      )
        evidence.postMfaSupport = true;
      if (
        evidence.postMfaSupport &&
        authenticated &&
        administrator.status === 403
      )
        evidence.adminDenied = true;
      if (
        logoutObserved &&
        evidence.postMfaSupport &&
        !authenticated &&
        !mfaPagePending &&
        me.status === 401 &&
        staff.status === 401 &&
        administrator.status === 401
      )
        evidence.logoutDenied = true;
      save();
      res.json({
        googleIdentityLinked: Boolean(user?.googleSub),
        supportFixturePrepared: prepared,
        chatforiaMfaEnabled: user?.twoFactorEnabled === true,
        staffStatus: staff.status,
        staffProfile: staffBody?.profile || null,
        adminStatus: administrator.status,
        sessionStatus: me.status,
        checks: evidence,
      });
    } catch {
      res
        .status(503)
        .json({ error: 'Local observation unavailable; no success recorded.' });
    }
  });
  save();
  return {
    observeApi(req, res) {
      if (
        req.method === 'GET' &&
        req.originalUrl.split('?')[0] === '/auth/google/callback' &&
        res.statusCode === 302 &&
        req.user?.id === 3
      ) {
        evidence.realGoogle = true;
        save();
      }
      if (
        req.method === 'POST' &&
        req.originalUrl.split('?')[0] === '/auth/logout' &&
        res.statusCode === 200
      )
        logoutObserved = true;
    },
  };
}
