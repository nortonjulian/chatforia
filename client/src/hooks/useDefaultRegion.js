import { useMemo } from 'react';

export default function useDefaultRegion({ userCountryCode } = {}) {
  return useMemo(() => {
    // 1) user profile (best)
    if (userCountryCode && /^[A-Z]{2}$/.test(userCountryCode)) return userCountryCode;

    // 2) last choice saved
    const saved = localStorage.getItem('cf_default_region');
    if (saved && /^[A-Z]{2}$/.test(saved)) return saved;

    // 3) browser locale (en-US -> US)
    const fromNav = (navigator.language || '').split('-')[1];
    if (fromNav && /^[A-Z]{2}$/.test(fromNav.toUpperCase())) return fromNav.toUpperCase();

    // 4) server hint injected (optional)
    if (typeof window !== 'undefined' && window.__REGION__ && /^[A-Z]{2}$/.test(window.__REGION__)) {
      return window.__REGION__;
    }

    // 5) fallback
    return 'US';
  }, [userCountryCode]);
}
