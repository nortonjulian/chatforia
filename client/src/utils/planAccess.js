export function isPremiumUser(user) {
  if (!user) return false;

  if (String(user.role || '').trim().toUpperCase() === 'ADMIN') {
    return true;
  }

  // Prefer the backend-authoritative flag when serializeUser supplied it.
  if (typeof user.isPremium === 'boolean') {
    return user.isPremium;
  }

  const plan = String(user.plan || 'FREE').trim().toUpperCase();
  return plan === 'PREMIUM' || plan === 'PRO';
}

export function isPaidPlanUser(user) {
  if (!user) return false;

  if (String(user.role || '').trim().toUpperCase() === 'ADMIN') {
    return true;
  }

  const plan = String(user.plan || 'FREE').trim().toUpperCase();

  return plan === 'PLUS' || plan === 'PREMIUM' || plan === 'PRO';
}
