export function requirePremium(req, res, next) {
  const plan = String(req.user?.plan || req.user?.subscription || 'FREE').toUpperCase();

  if (req.user?.role === 'ADMIN') return next();

  if (['PLUS', 'PREMIUM', 'WIRELESS'].includes(plan)) {
    return next();
  }

  return res.status(402).json({
    error: 'premium_required',
    message: 'This feature requires a paid plan.',
  });
}