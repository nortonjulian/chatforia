import { useEffect, useRef, useState, useMemo } from 'react';
import { useAds } from './AdProvider';
import { getPlacementConfig } from './placements';

function canShowHouseOnceEvery(placement, capKey, cooldownMs) {
  const k = `housecap:${placement}:${capKey}`;
  const until = Number(localStorage.getItem(k) || 0);
  const ok = Date.now() >= until;
  return {
    ok,
    mark: () => localStorage.setItem(k, String(Date.now() + cooldownMs)),
  };
}

export default function AdSlot({
  placement,
  className,
  adsenseSlot,      // optional override
  sizes,            // optional override
  style,
  fallback = null,
  capKey = 'global',
  /** NEW: show house fallback at most once per this many ms (per placement/capKey) */
  fallbackCooldownMs = 15 * 60 * 1000, // 15 minutes
  /** NEW: chance to show house when there is no-fill (0..1) */
  fallbackChance = 0.6,
  lazy = true,
  forceHouse = true
}) {
  const ctx = typeof useAds === 'function' ? useAds() : null;
  const { adapter, isPremium, ready, adsense, prebid, ensurePrebid, canShow, markShown } = ctx || {};

  const cfg = useMemo(() => getPlacementConfig(placement) || {}, [placement]);
  const resolvedSizes = sizes || cfg.sizes || [[300, 250], [320, 50]];
  const resolvedAdsenseSlot = adsenseSlot ?? cfg.adsenseSlot ?? null;
  const rootMargin = cfg.lazyMargin || '200px';

  const [shown, setShown] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const containerRef = useRef(null);
  const renderedRef = useRef(false);
  const viewedRef = useRef(false);

  // Premium (or no provider): render fallback if provided
  if (!ctx || isPremium) {
    return fallback ? <div className={className} aria-label={`ad-${placement}`}>{fallback}</div> : null;
  }

  // Respect your global caps for the slot itself
  const eligible = canShow?.(placement, capKey) !== false;
  if (!eligible) {
    return fallback ? <div className={className} aria-label={`ad-${placement}`}>{fallback}</div> : null;
  }

  if (forceHouse && fallback) {
    return (
      <div className={className} aria-label={`ad-${placement}`} style={{ width: '100%', ...(style || {}) }}>
        {fallback}
      </div>
    );
  }



  const markHouseIfAllowed = () => {
    const { ok, mark } = canShowHouseOnceEvery(placement, capKey, fallbackCooldownMs);
    if (!ok) return false;
    if (Math.random() > fallbackChance) return false;
    mark();                // start cooldown
    return true;
  };

  // If adapter is clearly misconfigured, go straight to house — but still obey house cooldown/chance
  const adapterMisconfigured =
    (adapter === 'adsense' && (!adsense?.client || !resolvedAdsenseSlot)) ||
    (adapter === 'prebid' && (!window.googletag || !window.pbjs));

  // Lazy init
  useEffect(() => {
    if (!containerRef.current || viewedRef.current) return;

    if (!lazy) {
      viewedRef.current = true;
      setShown(true);
      markShown?.(placement, capKey);
      return;
    } 



    if (adapterMisconfigured) {
      if (fallback && markHouseIfAllowed()) setUseFallback(true);
      viewedRef.current = true;
      markShown?.(placement, capKey);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          viewedRef.current = true;
          setShown(true);
          markShown?.(placement, capKey);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0.1 }
    );
    io.observe(containerRef.current);
    return () => io.disconnect();
  // 
  

  // --- AdSense flow ---
  useEffect(() => {
    if (!shown || !ready || renderedRef.current) return;
    if (adapter !== 'adsense') return;

    if (!adsense?.client || !resolvedAdsenseSlot) {
      // No config → maybe show house (periodically)
      if (fallback && markHouseIfAllowed()) setUseFallback(true);
      return;
    }

    try {
      let ins = containerRef.current?.querySelector('ins.adsbygoogle');
      if (!ins && containerRef.current) {
        ins = document.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.style.display = 'block';
        ins.setAttribute('data-ad-client', adsense.client);
        ins.setAttribute('data-ad-slot', resolvedAdsenseSlot);
        ins.setAttribute('data-ad-format', 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
        if (import.meta.env.DEV) ins.setAttribute('data-adtest', 'on');
        containerRef.current.appendChild(ins);
      }
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      renderedRef.current = true;

      // No-fill / blocked detection → maybe show house
      const t = setTimeout(() => {
        const h = containerRef.current?.offsetHeight || 0;
        if (h < 10 && fallback && markHouseIfAllowed()) setUseFallback(true);
      }, 1500);
      return () => clearTimeout(t);
    } catch (e) {
      console.warn('[ads] AdSense render failed', e);
      if (fallback && markHouseIfAllowed()) setUseFallback(true);
    }
  }, [shown, ready, adapter, adsense?.client, resolvedAdsenseSlot, fallbackCooldownMs, fallbackChance]);
  }, [lazy, adapterMisconfigured, capKey, markShown, placement, rootMargin, fallbackCooldownMs, fallbackChance]);

  // --- Prebid + GPT flow ---
  useEffect(() => {
    if (!shown || !ready || renderedRef.current) return;
    if (adapter !== 'prebid') return;

    const { googletag, pbjs } = window;
    if (!googletag || !pbjs) {
      if (fallback && markHouseIfAllowed()) setUseFallback(true);
      return;
    }

    ensurePrebid?.(placement, resolvedSizes);

    const slotId = `gpt-${placement}`;
    let el = document.getElementById(slotId);
    if (!el && containerRef.current) {
      el = document.createElement('div');
      el.id = slotId;
      el.style.minHeight = '50px';
      containerRef.current.appendChild(el);
    }
    if (!el) return;

    pbjs.que.push(() => {
      pbjs.requestBids({
        adUnitCodes: [placement],
        timeout: prebid?.timeoutMs || 1000,
        bidsBackHandler: () => {
          try {
            pbjs.setTargetingForGPTAsync([placement]);
            googletag.cmd.push(() => {
              googletag.display(slotId);
              googletag.pubads().refresh();
            });
            renderedRef.current = true;

            // If slot didn't expand → maybe house
            setTimeout(() => {
              const h = containerRef.current?.offsetHeight || 0;
              if (h < 10 && fallback && markHouseIfAllowed()) setUseFallback(true);
            }, 1500);
          } catch (err) {
            console.warn('[ads] GPT render failed', err);
            if (fallback && markHouseIfAllowed()) setUseFallback(true);
          }
        },
      });
    });
  }, [shown, ready, adapter, placement, resolvedSizes, prebid, ensurePrebid, fallbackCooldownMs, fallbackChance]);

  console.log('[AdSlot]', { placement, shown, useFallback, adapter, eligible: canShow?.(placement, capKey) });
  return (
    <div
      ref={containerRef}
      className={className}
      style={{ minHeight: 64, display: 'block', width: '100%', ...(style || {}) }}
      aria-label={`ad-${placement}`}
    >
      {(!shown || useFallback) && fallback ? fallback : null}
    </div>
  );
}
