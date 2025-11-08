import { Card, Text, Button, Group } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function UpgradeCard() {
  // Use the default 'translation' namespace with a keyPrefix for brevity
  const { t } = useTranslation('translation', { keyPrefix: 'upgrade' });

  return (
    <Card withBorder p="md" radius="lg">
      <Group justify="space-between" align="center" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text fw={600}>
            {t('goPremium', { defaultValue: 'Go Premium' })}
          </Text>
          <Text size="sm" c="dimmed">
            {t('benefitsLine', {
              defaultValue: 'Unlock power features & remove ads.',
            })}
          </Text>
        </div>

        <Button
          component={Link}
          to="/settings/upgrade"
          variant="light"
          style={{ whiteSpace: 'nowrap' }}
          aria-label={t('aria', { defaultValue: 'Upgrade to Chatforia Premium' })}
          onClick={(e) => e.stopPropagation()}
        >
          {t('cta', { defaultValue: 'Upgrade' })}
        </Button>
      </Group>
    </Card>
  );
}
