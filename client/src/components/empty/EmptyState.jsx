import { useEffect, useState } from 'react';
import { Center, Stack, Text, Button, Box } from '@mantine/core';

// Ads
import HouseAdSlot from '@/ads/HouseAdSlot';
import { useAds } from '@/ads/AdProvider';
import { PLACEMENTS } from '@/ads/placements';
import { CardAdWrap } from '@/ads/AdWrappers';

import { ADS_CONFIG } from '@/ads/config';

/** Local helper: remember dismissal for N days */
function useDismissed(key, days = 14) {
  const storageKey = `dismiss:${key}`;
  const [dismissed, setDismissed] = useState(() => {
    const until = Number(localStorage.getItem(storageKey) || 0);
    return Date.now() < until;
  });
  const dismiss = () => {
    localStorage.setItem(storageKey, String(Date.now() + days * 24 * 60 * 60 * 1000));
    setDismissed(true);
  };
  return [dismissed, dismiss];
}

/**
 * Props kept backward-compatible:
 * - title, subtitle, cta, onCta (unchanged)
 * New (optional):
 * - isPremium: boolean (default false)
 * - enableHousePromo: boolean (default true)
 * - capKey: string (default 'app')
 */
export default function EmptyState({
  title,
  subtitle,
  cta,
  onCta,
  isPremium = false,
  enableHousePromo = true,
  capKey = 'app',
}) {
  const ads = useAds();
  const [dismissed, dismiss] = useDismissed('empty_state_promo', 14);

  const canShow = ads?.canShow?.(PLACEMENTS.EMPTY_STATE_PROMO, capKey) ?? true;
  const showPromo = enableHousePromo && !isPremium && !dismissed && canShow;

  useEffect(() => {
    if (showPromo) ads?.markShown?.(PLACEMENTS.EMPTY_STATE_PROMO, capKey);
  }, [showPromo, ads, capKey]);

  if (import.meta.env.DEV) {
    console.log('[EmptyState] isPremium =', isPremium);
    console.log('[EmptyState] ADS house keys:', Object.keys(ADS_CONFIG?.house || {}));
  }

  return (
    <Center mih={240} p="lg">
      <Stack gap="xs" align="center" w="100%" maw={520}>
        <Text fw={700}>{title}</Text>
        {subtitle && <Text c="dimmed" ta="center">{subtitle}</Text>}
        {cta && <Button onClick={onCta} variant="light">{cta}</Button>}

        {/* DEV helper: visible box proving component mounted */}
        {import.meta.env.DEV && !isPremium && (
          <Box
            mt="sm"
            style={{
              outline: '2px dashed #0aa',
              padding: 8,
              borderRadius: 8,
              background: 'rgba(0,170,170,.06)',
              maxWidth: 420,
            }}
          >
            <Text size="xs" c="teal">[DEV] EmptyState is mounted</Text>
          </Box>
        )}

        {/* House promo (non-premium, capped, dismissible) */}
        {showPromo && (
          <CardAdWrap>
            <HouseAdSlot placement="empty_state_promo" variant="card" />
            <Button
              size="xs"
              variant="subtle"
              onClick={dismiss}
              aria-label="Hide promotion"
              mt="xs"
            >
              Hide for now
            </Button>
          </CardAdWrap>
        )}
      </Stack>
    </Center>
  );
}
