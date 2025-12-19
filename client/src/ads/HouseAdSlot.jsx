import { Card, Group, Text, Button, Image, Box, Badge } from '@mantine/core';
import { ADS_CONFIG } from './config';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';

export default function HouseAdSlot({
  placement,
  type,
  variant = 'card',
  align = 'center',
  style,
  frameless = false,
  rotate = true, // ✅ allow rotation for house creatives
  ...props
}) {
  const nav = useNavigate();
  const { t, i18n } = useTranslation('translation');

  const key = placement ?? type ?? 'default';
  const pool = ADS_CONFIG?.house?.[key] ?? ADS_CONFIG?.house?.default ?? [];

  // ✅ pick a creative deterministically per language + key (so it rotates but doesn't flicker)
  const creative = useMemo(() => {
    if (!pool.length) return null;
    if (!rotate || pool.length === 1) return pool[0];

    // Stable-ish seed per locale + placement so it changes when language changes,
    // but doesn't rerender-flicker on every render.
    const seedStr = `${i18n.resolvedLanguage || i18n.language || 'en'}:${key}`;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) >>> 0;
    return pool[hash % pool.length];
  }, [pool, rotate, i18n.resolvedLanguage, i18n.language, key]);

  if (!creative) return null;

  // Resolve i18n keys with hardcoded English as default
  const resolve = (field) => {
    const k = creative[`${field}Key`];
    const def = creative[field];
    return k ? t(k, { defaultValue: def }) : def ?? '';
  };

  const title = resolve('title');
  const body = resolve('body');
  const cta = resolve('cta');

  const open = () => {
    const href = creative.href;
    if (!href) return;

    if (href.startsWith('/')) {
      nav(href);
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const outerJustify =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  const outerStyle = {
    display: 'flex',
    justifyContent: outerJustify,
    ...(variant === 'card' && { maxWidth: 300, margin: '0 auto', width: '100%' }),
    ...(variant === 'banner' && { maxWidth: 728, margin: '0 auto', width: '100%' }),
    ...style,
  };

  const CardFrame = ({ children }) => (
    <Card
      withBorder={!frameless}
      radius={variant === 'pill' ? 'xl' : variant === 'banner' ? 'md' : 'lg'}
      p={variant === 'pill' ? 6 : variant === 'banner' ? 'sm' : 'md'}
      shadow={variant === 'pill' ? 'xs' : undefined}
      style={{
        width: variant === 'pill' ? 'auto' : '100%',
        background: frameless ? 'transparent' : undefined,
        boxShadow: frameless ? 'none' : undefined,
        border: frameless ? 'none' : undefined,
        ...(variant === 'pill' && { display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: 520 }),
      }}
      {...props}
    >
      {children}
    </Card>
  );

  if (variant === 'pill') {
    return (
      <Box style={{ display: 'flex', justifyContent: outerJustify, ...style }}>
        <CardFrame>
          {creative.img ? (
            <Image
              src={creative.img}
              alt={creative.alt || 'Ad'}
              width={20}
              height={20}
              radius="xl"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <Badge size="xs" variant="light">
              Ad
            </Badge>
          )}

          <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
            {title}
          </Text>

          {body && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {body}
            </Text>
          )}

          <Button
            size="xs"
            radius="xl"
            onClick={open}
            disabled={!creative.href}
            style={{ whiteSpace: 'nowrap', minWidth: 96, flexShrink: 0 }}
            styles={{ label: { whiteSpace: 'nowrap' } }}
          >
            {cta || t('common.learnMore', { defaultValue: 'Learn more' })}
          </Button>
        </CardFrame>
      </Box>
    );
  }

  if (variant === 'banner') {
    return (
      <Box style={outerStyle}>
        <CardFrame>
          <Group justify="space-between" align="center" wrap="nowrap">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
              {creative.img && (
                <Image
                  src={creative.img}
                  alt={creative.alt || 'Advertisement'}
                  width={32}
                  height={32}
                  radius="sm"
                  style={{ objectFit: 'cover' }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <Text fw={600} size="sm" lineClamp={1}>
                  {title}
                </Text>
                {body && (
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {body}
                  </Text>
                )}
              </div>
            </div>

            <Button
              onClick={open}
              size="xs"
              disabled={!creative.href}
              style={{ whiteSpace: 'nowrap', minWidth: 100, flexShrink: 0 }}
              styles={{ label: { whiteSpace: 'nowrap' } }}
            >
              {cta || t('common.learnMore', { defaultValue: 'Learn more' })}
            </Button>
          </Group>
        </CardFrame>
      </Box>
    );
  }

  // ✅ Image creative path: use same open() behavior so internal routes work
  if (creative.kind === 'image') {
    return (
      <Box style={outerStyle}>
        <Box
          role="button"
          tabIndex={0}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') open();
          }}
          style={{ display: 'block', width: '100%', cursor: creative.href ? 'pointer' : 'default' }}
          aria-label={cta ? `${title} — ${cta}` : title}
        >
          <Image
            src={creative.img}
            alt={creative.alt || 'Advertisement'}
            radius="md"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </Box>
      </Box>
    );
  }

  // default card
  return (
    <Box style={outerStyle}>
      <CardFrame>
        <Group justify="space-between" align="center" wrap="nowrap">
          <div>
            <Text fw={600}>{title}</Text>
            {body ? (
              <Text c="dimmed" size="sm">
                {body}
              </Text>
            ) : null}
          </div>

          <Button
            onClick={open}
            size="sm"
            disabled={!creative.href}
            style={{ whiteSpace: 'nowrap', minWidth: 100, flexShrink: 0 }}
            styles={{ label: { whiteSpace: 'nowrap' } }}
          >
            {cta || t('common.learnMore', { defaultValue: 'Learn more' })}
          </Button>
        </Group>
      </CardFrame>
    </Box>
  );
}
