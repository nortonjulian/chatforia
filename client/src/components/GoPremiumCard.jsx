import { memo } from 'react';
import { Card, Group, Stack, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n'; // bind to the app's singleton instance

function GoPremiumCard({ compact = false, className, ...props }) {
  // Subscribe to the same i18n instance + default "translation" namespace
  const { t } = useTranslation('translation', { i18n });

  const padding = compact ? 'sm' : 'md';
  const btnSize = compact ? 'sm' : 'md';
  const minBtnWidth = compact ? 96 : 110;

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
            {t('upgrade.goPremium')}
          </Text>
          <Text c="dimmed" size="sm" truncate="end" data-testid="go-premium-subtitle">
            {t('upgrade.benefitsLine')}
          </Text>
        </Stack>

        <Button
          component={Link}
          to="/settings/upgrade"
          size={btnSize}
          variant="filled"
          style={{ whiteSpace: 'nowrap', minWidth: minBtnWidth }}
          aria-label={t('upgrade.aria')}
          onClick={(e) => e.stopPropagation()}
          data-testid="go-premium-cta"
        >
          {t('upgrade.cta')}
        </Button>
      </Group>
    </Card>
  );
}

export default memo(GoPremiumCard);
