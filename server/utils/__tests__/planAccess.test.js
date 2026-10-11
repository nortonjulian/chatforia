import { describe, it, expect } from '@jest/globals';
import { hasActivePlanAccess, hasPremiumAccess } from '../planAccess.js';

describe('planAccess', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it('allows ADMIN regardless of plan or subscription state', () => {
    expect(
      hasPremiumAccess({
        role: 'ADMIN',
        plan: 'FREE',
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: past,
      })
    ).toBe(true);
  });

  it('allows ACTIVE Premium', () => {
    expect(
      hasPremiumAccess({
        role: 'USER',
        plan: 'PREMIUM',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: future,
      })
    ).toBe(true);
  });

  it('allows TRIALING Premium', () => {
    expect(
      hasPremiumAccess({
        role: 'USER',
        plan: 'PREMIUM',
        subscriptionStatus: 'TRIALING',
        subscriptionEndsAt: future,
      })
    ).toBe(true);
  });

  it('allows ACTIVE Premium with no end date', () => {
    expect(
      hasPremiumAccess({
        role: 'USER',
        plan: 'PREMIUM',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: null,
      })
    ).toBe(true);
  });

  it('rejects expired Premium', () => {
    expect(
      hasPremiumAccess({
        role: 'USER',
        plan: 'PREMIUM',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: past,
      })
    ).toBe(false);
  });

  it('rejects INACTIVE Premium', () => {
    expect(
      hasPremiumAccess({
        role: 'USER',
        plan: 'PREMIUM',
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: null,
      })
    ).toBe(false);
  });

  it.each(['PLUS', 'FREE', 'WIRELESS'])(
    'rejects %s for Premium access',
    (plan) => {
      expect(
        hasPremiumAccess({
          role: 'USER',
          plan,
          subscriptionStatus: 'ACTIVE',
          subscriptionEndsAt: future,
        })
      ).toBe(false);
    }
  );

  it('requires exact plan match for generic access', () => {
    const plus = {
      role: 'USER',
      plan: 'PLUS',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt: future,
    };

    expect(hasActivePlanAccess(plus, 'PLUS')).toBe(true);
    expect(hasActivePlanAccess(plus, 'PREMIUM')).toBe(false);
  });
});
