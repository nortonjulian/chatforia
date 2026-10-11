export function hasActivePlanAccess(user, requiredPlan, now = new Date()) {
  if (!user) return false;

  if (String(user.role || '').trim().toUpperCase() === 'ADMIN') {
    return true;
  }

  const plan = String(user.plan || 'FREE').trim().toUpperCase();
  const required = String(requiredPlan || '').trim().toUpperCase();

  if (!required || plan !== required) {
    return false;
  }

  const status = String(user.subscriptionStatus || '')
    .trim()
    .toUpperCase();

  if (status !== 'ACTIVE' && status !== 'TRIALING') {
    return false;
  }

  if (!user.subscriptionEndsAt) {
    return true;
  }

  const endsAt = new Date(user.subscriptionEndsAt);

  return !Number.isNaN(endsAt.getTime()) && endsAt > now;
}

export function hasPremiumAccess(user, now = new Date()) {
  return hasActivePlanAccess(user, 'PREMIUM', now);
}
