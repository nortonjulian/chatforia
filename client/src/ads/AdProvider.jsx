import React from 'react';
import useIsPremium from '@/hooks/useIsPremium';

const AdsContext = React.createContext(null);

export function useAds() {
  return React.useContext(AdsContext);
}

export function AdProvider({ children, isPremium: isPremiumProp }) {
  const hookPremium = useIsPremium();

  const isPremium =
    typeof isPremiumProp === 'boolean' ? isPremiumProp : hookPremium;

  const adsEnabled = import.meta.env.VITE_ADS_ENABLED !== 'false';
  const provider = String(import.meta.env.VITE_AD_PROVIDER || 'house')
    .toLowerCase()
    .trim();

  const canShow = React.useCallback(
    (placement, capKey = 'global', cooldownMs = 30 * 60 * 1000) => {
      if (!adsEnabled) return false;
      if (isPremium) return false;
      if (!placement) return false;

      try {
        const k = `ads:shown:${placement}:${capKey}`;
        const last = Number(localStorage.getItem(k) || 0);
        return Date.now() - last > cooldownMs;
      } catch {
        return true;
      }
    },
    [adsEnabled, isPremium]
  );

  const markShown = React.useCallback((placement, capKey = 'global') => {
    if (!placement) return;
    try {
      const k = `ads:shown:${placement}:${capKey}`;
      localStorage.setItem(k, String(Date.now()));
    } catch {
      // ignore
    }
  }, []);

  const value = React.useMemo(
    () => ({
      adsEnabled,
      provider,
      isPremium,
      canShow,
      markShown,
    }),
    [adsEnabled, provider, isPremium, canShow, markShown]
  );

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}