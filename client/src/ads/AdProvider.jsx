import React from 'react';
import useIsPremium from '@/hooks/useIsPremium';

const AdsContext = React.createContext(null);

export function useAds() {
  return React.useContext(AdsContext);
}

export function AdProvider({ children }) {
  const isPremium = useIsPremium();

  // Simple caps/cooldowns using localStorage
  const canShow = React.useCallback(
    (placement, capKey = 'global', cooldownMs = 30 * 60 * 1000) => {
      if (isPremium) return false;
      if (!placement) return false;

      try {
        const k = `ads:shown:${placement}:${capKey}`;
        const last = Number(localStorage.getItem(k) || 0);
        return Date.now() - last > cooldownMs;
      } catch {
        // If storage blocked/unavailable, just allow showing
        return true;
      }
    },
    [isPremium]
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
    () => ({ isPremium, canShow, markShown }),
    [isPremium, canShow, markShown]
  );

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}
