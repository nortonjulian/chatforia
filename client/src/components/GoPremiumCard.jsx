import { memo } from 'react';
import { Card, Group, Stack, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

function GoPremiumCard({ compact = false, className, ...props }) {
  const { t } = useTranslation('translation');

  const padding = compact ? 'sm' : 'md';
  const btnSize = compact ? 'sm' : 'md';
  const minBtnWidth = compact ? 96 : 110;

  const title = t('premium.heading', { defaultValue: 'Go Premium' });
  const subtitle = t('premium.description', { defaultValue: 'Unlock power features & remove ads.' });
  const ctaText = t('premium.upgrade', { defaultValue: 'Upgrade' });
  const aria = t('premium.upgradeAria', { defaultValue: 'Upgrade to Chatforia Premium' });

  return (
    <Card
      withBorder
      radius="lg"
      p={padding}
      maw={360}
      w="100%"
      className={className}
      data-testid="go-premium-card"
      {...props}
    >
      <Group justify="space-between" align="center" wrap="nowrap" gap="md">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} lh={1.2} truncate="end" data-testid="go-premium-title">
            {title}
          </Text>
          <Text c="dimmed" size="sm" truncate="end" data-testid="go-premium-subtitle">
            {subtitle}
          </Text>
        </Stack>

        <Button
          component={Link}
          to="/settings/upgrade"
          size={btnSize}
          variant="filled"
          style={{ whiteSpace: 'nowrap', minWidth: minBtnWidth }}
          aria-label={aria}
          onClick={(e) => e.stopPropagation()}
          data-testid="go-premium-cta"
        >
          {ctaText}
        </Button>
      </Group>
    </Card>
  );
}

export default memo(GoPremiumCard);
