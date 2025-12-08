import { Card, Group, Text, Button, Image, Box, Badge } from '@mantine/core';
import { ADS_CONFIG } from './config';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function HouseAdSlot({
  placement,
  type,
  variant = 'card',
  align = 'center',
  style,
  frameless = false,
  ...props
}) {
  const nav = useNavigate();
  const { t, i18n } = useTranslation('translation');

  const key = placement ?? type ?? 'default';
  const pool = ADS_CONFIG?.house?.[key] ?? ADS_CONFIG?.house?.default ?? [];
  const creative = pool[0];

  if (!creative) return null;

  // Resolve i18n keys with hardcoded English as default
  const resolve = (field) => {
    const k = creative[`${field}Key`];
    const def = creative[field];
    return k ? t(k, { defaultValue: def }) : (def ?? '');
  };

  // Touch language so the component re-renders when language changes
  const _lng = i18n.resolvedLanguage; // eslint-disable-line no-unused-vars

  const title = resolve('title');
  const body  = resolve('body');
  const cta   = resolve('cta');

  const open = () =>
    creative.href?.startsWith('/')
      ? nav(creative.href)
      : window.open(creative.href, '_blank', 'noopener,noreferrer');

  const outerJustify =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  const outerStyle = {
    display: 'flex',
    justifyContent: outerJustify,
    ...(variant === 'card'   && { maxWidth: 300, margin: '0 auto', width: '100%' }),
    ...(variant === 'banner' && { maxWidth: 728, margin: '0 auto', width: '100%' }),
    ...style,
  };

  if (variant === 'pill') {
    return (
      <Box style={{ display: 'flex', justifyContent: outerJustify, ...style }}>
        <Card withBorder shadow="xs" radius="xl" px="sm" py={6}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: 520 }}>
          {creative.img ? (
            <Image src={creative.img} alt={creative.alt || 'Ad'} width={20} height={20} radius="xl" style={{ objectFit: 'cover' }} />
          ) : (
            <Badge size="xs" variant="light">Ad</Badge>
          )}
          <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>{title}</Text>
          {body && <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{body}</Text>}
          <Button size="xs" radius="xl" onClick={open} style={{ whiteSpace: 'nowrap', minWidth: 96, flexShrink: 0 }}
            styles={{ label: { whiteSpace: 'nowrap' } }}>
            {cta || t('common.learnMore', { defaultValue: 'Learn more' })}
          </Button>
        </Card>
      </Box>
    );
  }

  if (variant === 'banner') {
    return (
      <Box style={outerStyle}>
        <Card withBorder={!frameless} radius="md" p="sm"
          style={{ width: '100%', background: frameless ? 'transparent' : undefined, boxShadow: frameless ? 'none' : undefined, border: frameless ? 'none' : undefined }}>
          <Group justify="space-between" align="center" wrap="nowrap">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
              {creative.img && (
                <Image src={creative.img} alt={creative.alt || 'Advertisement'} width={32} height={32} radius="sm" style={{ objectFit: 'cover' }} />
              )}
              <div style={{ minWidth: 0 }}>
                <Text fw={600} size="sm" lineClamp={1}>{title}</Text>
                {body && <Text size="xs" c="dimmed" lineClamp={2}>{body}</Text>}
              </div>
            </div>
            <Button onClick={open} size="xs" style={{ whiteSpace: 'nowrap', minWidth: 100, flexShrink: 0 }}
              styles={{ label: { whiteSpace: 'nowrap' } }}>
              {cta || t('common.learnMore', { defaultValue: 'Learn more' })}
            </Button>
          </Group>
        </Card>
      </Box>
    );
  }

  if (creative.kind === 'image') {
    return (
      <Box style={outerStyle}>
        <a href={creative.href} target="_blank" rel="noreferrer noopener" style={{ display: 'block', width: '100%' }}>
          <Image src={creative.img} alt={creative.alt || 'Advertisement'} radius="md" style={{ width: '100%', height: 'auto', display: 'block' }} />
        </a>
      </Box>
    );
  }

  return (
    <Box style={outerStyle}>
      <Card withBorder={!frameless} radius="lg" p="md"
        style={{ width: '100%', background: frameless ? 'transparent' : undefined, boxShadow: frameless ? 'none' : undefined, border: frameless ? 'none' : undefined }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <div>
            <Text fw={600}>{title}</Text>
            {body ? <Text c="dimmed" size="sm">{body}</Text> : null}
          </div>
          <Button onClick={open} size="sm" style={{ whiteSpace: 'nowrap', minWidth: 100, flexShrink: 0 }}
            styles={{ label: { whiteSpace: 'nowrap' } }}>
            {cta || t('common.learnMore', { defaultValue: 'Learn more' })}
          </Button>
        </Group>
      </Card>
    </Box>
  );
}
