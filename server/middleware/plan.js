export function requirePremium(req, res, next) {
  const plan = req.user?.plan || req.user?.subscription || 'FREE';

  // Allow admins regardless of plan
  if (req.user?.role === 'ADMIN') return next();

  // Handle string-based plans
  if (typeof plan === 'string' && ['FREE', 'PREMIUM', 'PLUS'].includes(plan.toUpperCase())) {
    return next();
  }

  // Handle object-based (e.g., { isPremium: true })
  if (plan?.isPremium) return next();

  return res.status(402).json({ error: 'Premium plan required' });
}
