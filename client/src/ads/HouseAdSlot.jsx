import { Card, Group, Text, Button, Image, Box, Badge } from '@mantine/core';
import { ADS_CONFIG } from './config';
import { useNavigate } from 'react-router-dom';

export default function HouseAdSlot({
  placement,
  type,
  variant = 'card',      // 'pill' | 'card' | 'banner'
  align = 'center',      // 'left' | 'center' | 'right'
  style,
  frameless = false,     // remove white card/chrome, keep content
  ...props
}) {
  const nav = useNavigate();
  const key = placement ?? type ?? 'default';
  const pool = ADS_CONFIG?.house?.[key] ?? ADS_CONFIG?.house?.default ?? [];
  const creative = pool[0];

  if (!creative) {
    if (import.meta.env.DEV) {
      console.warn('[HouseAdSlot] NO CREATIVE for', key, {
        keys: Object.keys(ADS_CONFIG?.house || {}),
        placement,
        type,
      });
    }
    return null;
  }

  const open = () =>
    creative.href?.startsWith('/')
      ? nav(creative.href)
      : window.open(creative.href, '_blank', 'noopener,noreferrer');

  // alignment + variant sizing (with min widths to avoid CTA truncation)
  const outerJustify =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  const outerStyle = {
    display: 'flex',
    justifyContent: outerJustify,
    ...(variant === 'card'   && { maxWidth: 300, margin: '0 auto', width: '100%' }),
    ...(variant === 'banner' && { maxWidth: 728, margin: '0 auto', width: '100%' }),
    ...style,
  };

  /* ---------- PILL (super compact) ---------- */
  if (variant === 'pill') {
    return (
      <Box style={{ display: 'flex', justifyContent: outerJustify, ...style }}>
        <Card
          withBorder
          shadow="xs"
          radius="xl"
          px="sm"
          py={6}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: 520 }}
        >
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
            <Badge size="xs" variant="light">Ad</Badge>
          )}
          <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
            {creative.title}
          </Text>
          {creative.body && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {creative.body}
            </Text>
          )}
          <Button size="xs" radius="xl" onClick={open}>
            {creative.cta || 'Learn more'}
          </Button>
        </Card>
      </Box>
    );
  }

  /* ---------- BANNER (slim horizontal) ---------- */
  if (variant === 'banner') {
  return (
    <Box style={outerStyle}>
      <Card withBorder={!frameless} radius="md" p="sm"
            style={{ width:'100%', background: frameless ? 'transparent' : undefined, boxShadow: frameless ? 'none' : undefined, border: frameless ? 'none' : undefined }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <div style={{ display:'flex', gap:8, alignItems:'center', minWidth:0 }}>
            {creative.img && (
              <Image src={creative.img} alt={creative.alt || 'Advertisement'} width={32} height={32} radius="sm" style={{ objectFit:'cover' }} />
            )}
            <div style={{ minWidth:0 }}>
              <Text fw={600} size="sm" lineClamp={1}>{creative.title}</Text>
              {creative.body && <Text size="xs" c="dimmed" lineClamp={2}>{creative.body}</Text>}
            </div>
          </div>

          <Button
            onClick={open}
            size="xs"
            styles={{ root: { whiteSpace: 'normal', maxWidth: 160 } }}
          >
            {creative.cta || 'Learn more'}
          </Button>
        </Group>
      </Card>
    </Box>
  );
}

  /* ---------- CARD (image creative) ---------- */
  if (creative.kind === 'image') {
    return (
      <Box style={outerStyle}>
        <a
          href={creative.href}
          target="_blank"
          rel="noreferrer noopener"
          style={{ display: 'block', width: '100%' }}
        >
          <Image
            src={creative.img}
            alt={creative.alt || 'Advertisement'}
            radius="md"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </a>
      </Box>
    );
  }

  /* ---------- CARD (text creative, default) ---------- */
  return (
    <Box style={outerStyle}>
      <Card
        withBorder={!frameless}
        radius="lg"
        p="md"
        style={{
          width: '100%',
          background: frameless ? 'transparent' : undefined,
          boxShadow: frameless ? 'none' : undefined,
          border: frameless ? 'none' : undefined,
        }}
      >
        <Group justify="space-between" align="center" wrap="nowrap">
          <div>
            <Text fw={600}>{creative.title}</Text>
            {creative.body ? <Text c="dimmed" size="sm">{creative.body}</Text> : null}
          </div>
          <Button onClick={open} styles={{ root: { whiteSpace: 'normal' } }}>
            {creative.cta || 'Learn more'}
          </Button>
        </Group>
      </Card>
    </Box>
  );
}
