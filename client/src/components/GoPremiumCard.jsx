import { Card, Group, Stack, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';

export default function GoPremiumCard({ compact = false }) {
  return (
    <Card withBorder radius="lg" p={compact ? 'sm' : 'md'} maw={360} w="100%">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} style={{ lineHeight: 1.2 }}>
            Go Premium
          </Text>
          <Text c="dimmed" size="sm">
            Unlock power features & remove ads.
          </Text>
        </Stack>

        <Button
          component={Link}
          to="/settings/upgrade"                 // matches AppRoutes mounting of UpgradePlan
          size={compact ? 'sm' : 'md'}
          variant="filled"
          style={{ whiteSpace: 'nowrap', minWidth: compact ? 96 : 110 }} // never clip “Upgrade”
        >
          Upgrade
        </Button>
      </Group>
    </Card>
  );
}
