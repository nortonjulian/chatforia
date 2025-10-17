import { Card, Text, Button, Group } from '@mantine/core';
import { Link } from 'react-router-dom';

export default function UpgradeCard() {
  return (
    <Card withBorder p="md" radius="lg">
      <Group justify="space-between" align="center">
        <div>
          <Text fw={600}>Enjoy Chatforia ad-free</Text>
          <Text size="sm" c="dimmed">
            Upgrade to Premium to remove ads and unlock extra features.
          </Text>
        </div>

        <Button
          component={Link}
          to="/settings/upgrade"
          variant="light"
          style={{ whiteSpace: 'nowrap' }}
          aria-label="Upgrade to Chatforia Premium"
          onClick={(e) => e.stopPropagation()}
        >
          Upgrade
        </Button>
      </Group>
    </Card>
  );
}
