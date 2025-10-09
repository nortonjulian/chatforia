const STAFF = new Set(['ADMIN', 'MOD', 'STAFF']);

export function requireEmailVerified(req, res, next) {
  if (!req.user?.emailVerifiedAt) {
    return res.status(403).json({ ok: false, reason: 'email_verification_required' });
  }
  next();
}

export function requirePhoneVerified(req, res, next) {
  if (!req.user?.phoneVerifiedAt) {
    return res.status(403).json({ ok: false, reason: 'phone_verification_required' });
  }
  next();
}

export function requireStaff2FA(req, res, next) {
  if (STAFF.has(req.user?.role) && !req.user?.twoFactorEnabled) {
    return res.status(403).json({ ok: false, reason: '2fa_required' });
  }
  next();
}

/** Premium paywall for specific endpoints (e.g., locking numbers). */
export function requirePremium(req, res, next) {
  const plan = String(req.user?.plan || 'FREE').toUpperCase();
  if (plan !== 'PREMIUM') {
    return res.status(402).json({ ok: false, reason: 'premium_required' });
  }
  next();
}
