import { describe, it, expect } from '@jest/globals';
import { isPaidPlanUser, isPremiumUser } from '../planAccess.js';

describe('web plan access helpers', () => {
  it('treats Admin as paid and Premium', () => {
    const user = { role: 'ADMIN', plan: 'FREE', isPremium: false };
    expect(isPaidPlanUser(user)).toBe(true);
    expect(isPremiumUser(user)).toBe(true);
  });

  it('keeps Plus ad-free without granting Premium', () => {
    const user = { role: 'USER', plan: 'PLUS', isPremium: false };
    expect(isPaidPlanUser(user)).toBe(true);
    expect(isPremiumUser(user)).toBe(false);
  });

  it('grants Premium to backend-confirmed Premium', () => {
    const user = { role: 'USER', plan: 'PREMIUM', isPremium: true };
    expect(isPaidPlanUser(user)).toBe(true);
    expect(isPremiumUser(user)).toBe(true);
  });

  it('honors backend denial even when a stale plan string says Premium', () => {
    const user = { role: 'USER', plan: 'PREMIUM', isPremium: false };
    expect(isPremiumUser(user)).toBe(false);
  });

  it('keeps Free and Wireless non-paid and non-Premium', () => {
    for (const plan of ['FREE', 'WIRELESS']) {
      const user = { role: 'USER', plan, isPremium: false };
      expect(isPaidPlanUser(user)).toBe(false);
      expect(isPremiumUser(user)).toBe(false);
    }
  });

  it('supports legacy PRO as a paid Premium tier when no backend flag exists', () => {
    const user = { role: 'USER', plan: 'PRO' };
    expect(isPaidPlanUser(user)).toBe(true);
    expect(isPremiumUser(user)).toBe(true);
  });
});
