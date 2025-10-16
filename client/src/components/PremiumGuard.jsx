import { useUser } from '../context/UserContext';
import { Alert, Anchor, Card, Stack, Text, Button } from '@mantine/core';
import { useNavigate, Link } from 'react-router-dom';

/**
 * PremiumGuard
 * - variant="card" (default): renders a card with Upgrade CTA
 * - variant="inline": renders a subtle inline alert (no card)
 * - silent: renders nothing if not premium
 */
export default function PremiumGuard({ children, variant = 'card', silent = false }) {
  const { currentUser } = useUser();
  const navigate = useNavigate();

  const plan = (currentUser?.plan || 'FREE').toUpperCase();
  const isPremium =
    currentUser?.role === 'ADMIN' ||
    ['PREMIUM', 'PRO', 'PLUS'].includes(plan);

  if (isPremium) return children;
  if (silent) return null;

  if (variant === 'inline') {
    return (
      <Alert variant="light" color="blue">
        This is a Premium feature.{' '}
        <Anchor component={Link} to="/settings/upgrade">Upgrade</Anchor> to unlock.
      </Alert>
    );
  }

  // default: card
  return (
    <Card withBorder radius="md" p="md" shadow="sm">
      <Stack gap="xs" align="center">
        <Text size="sm" c="dimmed">This feature requires a Premium plan.</Text>
        <Button color="yellow" onClick={() => navigate('/settings/upgrade')}>
          Upgrade Now
        </Button>
      </Stack>
    </Card>
  );
}
