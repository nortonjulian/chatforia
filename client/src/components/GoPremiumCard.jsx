import { Card, Group, Stack, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function GoPremiumCard({ compact = false }) {
  const { t } = useTranslation();

  return (
    <Card withBorder radius="lg" p={compact ? 'sm' : 'md'} maw={360} w="100%">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} style={{ lineHeight: 1.2 }}>
            {t('upgrade.goPremium', 'Go Premium')}
          </Text>
          <Text c="dimmed" size="sm">
            {t('upgrade.benefitsLine', 'Unlock power features & remove ads.')}
          </Text>
        </Stack>

        <Button
          component={Link}
          to="/settings/upgrade"
          size={compact ? 'sm' : 'md'}
          variant="filled"
          style={{ whiteSpace: 'nowrap', minWidth: compact ? 96 : 110 }}
          aria-label={t('upgrade.aria', 'Upgrade to Chatforia Premium')}
          onClick={(e) => e.stopPropagation()}
        >
          {t('upgrade.cta', 'Upgrade')}
        </Button>
      </Group>
    </Card>
  );
}
