import { useUser } from '../context/UserContext';
import { Alert, Anchor, Card, Stack, Text, Button } from '@mantine/core';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isPremiumUser } from '@/utils/planAccess';

/**
 * PremiumGuard
 * - variant="card" (default): renders a card with Upgrade CTA
 * - variant="inline": renders a subtle inline alert (no card)
 * - silent: renders nothing if not premium
 *
 * Used for true Premium-only features (e.g. unlimited translation, advanced AI tools).
 */
export default function PremiumGuard({ children, variant = 'card', silent = false }) {
  const { currentUser } = useUser();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const isPremium = isPremiumUser(currentUser);

  if (isPremium) return children;
  if (silent) return null;

  if (variant === 'inline') {
    return (
      <Alert variant="light" color="blue" role="note">
        {t('premiumGuard.requiresPremium', 'This feature requires a Premium plan.')}{' '}
        <Anchor
          component={Link}
          to="/settings/upgrade"
        >
          {t('premiumGuard.toUnlock', 'Upgrade to unlock this feature.')}
        </Anchor>
      </Alert>
    );
  }

  // default: card
  return (
    <Card withBorder radius="md" p="md" shadow="sm" data-testid="premium-guard-card">
      <Stack gap="xs" align="center">
        <Text size="sm" c="dimmed">
          {t('premiumGuard.requiresPremium', 'This feature requires a Premium plan.')}
        </Text>
        <Button
          color="yellow"
          onClick={() => navigate('/settings/upgrade')}
          aria-label={t('premium.upgrade', 'Upgrade')}
        >
          {t('premium.upgrade', 'Upgrade')}
        </Button>
      </Stack>
    </Card>
  );
}
