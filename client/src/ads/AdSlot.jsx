import React, { useEffect, useMemo, useRef } from 'react';
import { Box } from '@mantine/core';
import { AdProvider, useAds } from '@/ads/AdProvider';
import { ADS_CONFIG } from './config';

/**
 * AdSlot
 *
 * Props:
 * - placement: string (required)
 * - capKey: string (optional) used to scope per-room caps
 * - lazy: boolean (optional) If true, only marks shown once it enters viewport
 * - minHeight: number (optional) reserve height to reduce layout shift
 * - fallback: ReactNode (optional) e.g., <HouseAdSlot .../>
 * - render: (ad) => ReactNode (optional) if you have network ads later
 *
 * Currently: If no network ads configured, it renders fallback only.
 */
export default function AdSlot({
  placement,
  capKey,
  lazy = true,
  minHeight = 0,
  fallback = null,
  render = null,
  style,
  ...props
}) {
  const ads = useAds();

  const canShow = ads?.canShow ? ads.canShow(placement, capKey) : true;
  const markShown = ads?.markShown ? ads.markShown : () => {};

  // StrictMode-safe "mark only once"
  const markedRef = useRef(false);

  // In the future you might use ADS_CONFIG.network[placement] etc.
  // For now, we treat "network ad" as optional.
  const networkCreative = useMemo(() => {
    const pool = ADS_CONFIG?.network?.[placement] ?? [];
    return pool?.length ? pool[0] : null;
  }, [placement]);

  const hasNetwork = Boolean(networkCreative);
  const content = hasNetwork
    ? (render ? render(networkCreative) : null)
    : fallback;

  // If we can’t show (cooldown/cap), return nothing.
  if (!placement || !canShow || !content) return null;

  // If not lazy, mark shown immediately on mount
  useEffect(() => {
    if (!lazy) {
      if (markedRef.current) return;
      markedRef.current = true;
      markShown(placement, capKey);
    }
  }, [lazy, placement, capKey, markShown]);

  // Lazy: mark shown when it enters viewport
  const rootRef = useRef(null);
  useEffect(() => {
    if (!lazy) return;

    const el = rootRef.current;
    if (!el) return;

    // Already marked?
    if (markedRef.current) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (markedRef.current) return;
        markedRef.current = true;
        markShown(placement, capKey);
        obs.disconnect();
      },
      { threshold: 0.25 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [lazy, placement, capKey, markShown]);

  return (
    <Box
      ref={rootRef}
      style={{
        minHeight: minHeight || undefined,
        width: '100%',
        ...style,
      }}
      {...props}
    >
      {content}
    </Box>
  );
}
