// server/__tests__/utils/subscription.test.js

import { isPremiumPlan } from '../../utils/subscription.js';

describe('isPremiumPlan', () => {
  test('returns false for missing / falsy values', () => {
    expect(isPremiumPlan(undefined)).toBe(false);
    expect(isPremiumPlan(null)).toBe(false);
    expect(isPremiumPlan('')).toBe(false);
    expect(isPremiumPlan(0)).toBe(false);
    expect(isPremiumPlan(false)).toBe(false);
  });

  test('returns false for FREE (any case)', () => {
    expect(isPremiumPlan('FREE')).toBe(false);
    expect(isPremiumPlan('free')).toBe(false);
    expect(isPremiumPlan('FrEe')).toBe(false);
  });

  test('returns true for any non-FREE string', () => {
    expect(isPremiumPlan('PLUS')).toBe(true);
    expect(isPremiumPlan('Premium')).toBe(true);
    expect(isPremiumPlan('ENTERPRISE')).toBe(true);
    expect(isPremiumPlan('lifetime')).toBe(true);
    expect(isPremiumPlan('trial')).toBe(true);
    expect(isPremiumPlan('not_free')).toBe(true);
  });

  test('coerces non-string inputs and still applies rule', () => {
    // numbers get String() then .toUpperCase()
    expect(isPremiumPlan(123)).toBe(true); // "123" !== "FREE"
    // truthy booleans become "true" which !== "FREE"
    expect(isPremiumPlan(true)).toBe(true);
  });
});
