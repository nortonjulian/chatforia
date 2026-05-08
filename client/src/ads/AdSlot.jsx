import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Text } from '@mantine/core';
import { useAds } from '@/ads/AdProvider';
import HouseAdSlot from '@/ads/HouseAdSlot';
import { getPlacementConfig } from '@/ads/placements';

function AdsenseSlot({ placement, config }) {
  const pubId = import.meta.env.VITE_ADSENSE_PUB_ID;
  const slot = config?.adsenseSlot;

  useEffect(() => {
    try {
      if (!pubId || !slot) return;
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch (e) {
      console.warn('[adsense] push failed', e);
    }
  }, [pubId, slot, placement]);

  if (!pubId || !slot) return null;

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block', width: '100%' }}
      data-ad-client={pubId}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}

function MediaNetSlot({ placement, config }) {
  const cid = import.meta.env.VITE_MEDIANET_CID;

  const placementKey = String(placement || '').toUpperCase();
  const envKey = `VITE_MEDIANET_${placementKey}`;
  const divId = import.meta.env[envKey];

  if (!cid || !divId) return null;

  return (
    <Box
      id={divId}
      style={{
        minHeight: config?.sizes?.[0]?.[1] || 250,
        width: '100%',
      }}
    >
      <Text size="xs" c="dimmed" ta="center">
        Sponsored
      </Text>
    </Box>
  );
}

/**
 * AdSlot
 *
 * Provider modes:
 * - house: internal promo cards only
 * - adsense: Google AdSense when configured, otherwise fallback
 * - medianet: Media.net when configured, otherwise fallback
 */
export default function AdSlot({
  placement,
  capKey = 'global',
  lazy = true,
  minHeight = 0,
  fallback = null,
  houseVariant = 'card',
  style,
  ...props
}) {
  const ads = useAds();
  const config = useMemo(() => getPlacementConfig(placement), [placement]);

  const cooldownMs = config?.cap?.coolMs ?? 30 * 60 * 1000;
  const canShow = ads?.canShow
    ? ads.canShow(placement, capKey, cooldownMs)
    : true;

  const markShown = ads?.markShown || (() => {});
  const provider = ads?.provider || 'house';

  const markedRef = useRef(false);
  const rootRef = useRef(null);

  const houseFallback =
    fallback ?? (
      <HouseAdSlot
        placement={placement}
        variant={houseVariant}
      />
    );

  const content = useMemo(() => {
    if (config?.houseOnly) return houseFallback;

    if (provider === 'adsense') {
      return (
        <AdsenseSlot
          placement={placement}
          config={config}
        />
      );
    }

    if (provider === 'medianet') {
      return (
        <MediaNetSlot
          placement={placement}
          config={config}
        />
      );
    }

    return houseFallback;
  }, [provider, placement, config, houseFallback]);

  if (!placement || !canShow || !content) return null;

  useEffect(() => {
    if (!lazy) {
      if (markedRef.current) return;
      markedRef.current = true;
      markShown(placement, capKey);
    }
  }, [lazy, placement, capKey, markShown]);

  useEffect(() => {
    if (!lazy) return;

    const el = rootRef.current;
    if (!el) return;
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