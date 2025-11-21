import { useEffect, useState } from 'react';
import {
  Title,
  Text,
  Stack,
  Card,
  Group,
  Button,
  Progress,
  Table,
  TextInput,
  Alert,
  CopyButton,
  ActionIcon,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { Copy, Info, Plus, Users } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { getMyFamily, createFamilyInvite } from '@/api/family';
import { createFamilyCheckoutSession } from '@/api/billing';

function formatGb(mb) {
  if (!mb || mb <= 0) return '0 GB';
  return `${(mb / 1024).toFixed(1)} GB`;
}

export default function FamilyDashboard() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [family, setFamily] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentUser) {
      navigate('/login?next=/family');
      return;
    }

    (async () => {
      try {
        setLoading(true);
        const fam = await getMyFamily();
        setFamily(fam);
      } catch (e) {
        console.error('Failed to load family', e);
        setError(t('family.error.load', 'Failed to load family details.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, navigate, t]);

  const handleCreateInvite = async () => {
    try {
      setInviteLoading(true);
      setError(null);
      const invite = await createFamilyInvite({
        email: inviteEmail || undefined,
      });
      setInviteUrl(invite.joinUrl);
      setInviteEmail('');
    } catch (e) {
      console.error('Failed to create invite', e);
      setError(
        t(
          'family.error.invite',
          'Could not create an invite. Make sure you are the family owner and try again.',
        ),
      );
    } finally {
      setInviteLoading(false);
    }
  };

  // Start a recurring Family plan checkout (e.g. MEDIUM by default)
  const handleStartFamilyPlan = async () => {
    try {
      setError(null);
      // You can later expose SMALL/MEDIUM/LARGE as a choice in the UI.
      const { url } = await createFamilyCheckoutSession('MEDIUM');
      window.location.href = url;
    } catch (e) {
      console.error('Failed to start family plan checkout', e);
      setError(
        t(
          'family.error.checkout',
          'We could not start checkout for a Family plan. Please try again.',
        ),
      );
    }
  };

  if (loading) {
    return (
      <Stack maw={800} mx="auto" p="md">
        <Title order={2}>{t('family.title', 'Family')}</Title>
        <Text c="dimmed">{t('family.loading', 'Loading your family details…')}</Text>
      </Stack>
    );
  }

  if (!family) {
    // User has no family yet
    return (
      <Stack maw={800} mx="auto" p="md">
        <Title order={2}>{t('family.title', 'Family')}</Title>

        {error && (
          <Alert color="red" variant="light" icon={<Info size={16} />}>
            {error}
          </Alert>
        )}

        <Card radius="xl" withBorder>
          <Stack gap="sm">
            <Group>
              <Users size={20} />
              <Title order={3}>
                {t('family.none.title', 'No family set up yet')}
              </Title>
            </Group>
            <Text c="dimmed" size="sm">
              {t(
                'family.none.body',
                'To create a Chatforia Family and shared data pool, start a Family plan.',
              )}
            </Text>
            <Group>
              <Button onClick={handleStartFamilyPlan}>
                {t('family.none.goUpgrade', 'Start a Family plan')}
              </Button>
              {/* Optional: still let them see the full Upgrade page */}
              <Button component={Link} to="/upgrade" variant="subtle">
                {t('family.none.viewPlans', 'View all plans')}
              </Button>
            </Group>
          </Stack>
        </Card>
      </Stack>
    );
  }

  const used = family.usedDataMb || 0;
  const total = family.totalDataMb || 0;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  const isOwner = family.role === 'OWNER';

  return (
    <Stack maw={900} mx="auto" p="md" gap="lg">
      <Title order={2}>{t('family.title', 'Family')}</Title>

      {error && (
        <Alert color="red" variant="light" icon={<Info size={16} />}>
          {error}
        </Alert>
      )}

      <Card radius="xl" withBorder>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Title order={3}>
                {family.name || t('family.group.defaultName', 'My Chatforia Family')}
              </Title>
              <Text size="sm" c="dimmed">
                {t(
                  'family.group.role',
                  'Your role: {{role}}',
                  {
                    role:
                      family.role === 'OWNER'
                        ? t('family.role.owner', 'Owner')
                        : t('family.role.member', 'Member'),
                  },
                )}
              </Text>
            </Stack>
          </Group>

          <Stack gap={4} mt="sm">
            <Group justify="space-between" align="center">
              <Text size="sm" fw={500}>
                {t('family.data.heading', 'Shared data pool')}
              </Text>
              <Text size="sm">
                {formatGb(used)} / {formatGb(total)}
              </Text>
            </Group>
            <Progress value={pct} />
            <Text size="xs" c="dimmed">
              {t(
                'family.data.caption',
                'All members share this pool. We’ll warn you as you approach your limit.',
              )}
            </Text>
          </Stack>
        </Stack>
      </Card>

      {/* Members table */}
      <Card radius="xl" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>{t('family.members.title', 'Family members')}</Title>
            {isOwner && (
              <Button
                variant="light"
                size="xs"
                leftSection={<Plus size={14} />}
                onClick={() => {
                  // focus input below
                  const el = document.getElementById('family-invite-email');
                  if (el) el.focus();
                }}
              >
                {t('family.members.inviteCta', 'Invite member')}
              </Button>
            )}
          </Group>

          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('family.members.name', 'Name')}</Table.Th>
                <Table.Th>{t('family.members.role', 'Role')}</Table.Th>
                <Table.Th>{t('family.members.usage', 'Usage')}</Table.Th>
                <Table.Th>{t('family.members.limit', 'Limit')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {family.members.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>{m.displayName}</Table.Td>
                  <Table.Td>
                    {m.role === 'OWNER'
                      ? t('family.role.owner', 'Owner')
                      : t('family.role.member', 'Member')}
                  </Table.Td>
                  <Table.Td>{formatGb(m.usedDataMb)}</Table.Td>
                  <Table.Td>
                    {typeof m.limitDataMb === 'number' && m.limitDataMb > 0
                      ? formatGb(m.limitDataMb)
                      : t('family.members.unlimited', 'No specific limit')}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>

      {/* Invite section (owner only) */}
      {isOwner && (
        <Card radius="xl" withBorder>
          <Stack gap="sm">
            <Group align="center">
              <Plus size={18} />
              <Title order={4}>
                {t('family.invite.title', 'Invite a new member')}
              </Title>
            </Group>

            <Text size="sm" c="dimmed">
              {t(
                'family.invite.body',
                'Send an email or link to invite someone into your shared family data pool.',
              )}
            </Text>

            <Group align="flex-end" wrap="wrap">
              <TextInput
                id="family-invite-email"
                label={t('family.invite.emailLabel', 'Email (optional)')}
                placeholder={t('family.invite.emailPlaceholder', 'friend@example.com')}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                style={{ flexGrow: 1, minWidth: '240px' }}
              />
              <Button
                leftSection={<Plus size={16} />}
                onClick={handleCreateInvite}
                loading={inviteLoading}
              >
                {t('family.invite.create', 'Create invite')}
              </Button>
            </Group>

            {inviteUrl && (
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  {t('family.invite.linkLabel', 'Invite link')}
                </Text>
                <Group wrap="nowrap">
                  <Text
                    size="sm"
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {inviteUrl}
                  </Text>
                  <CopyButton value={inviteUrl}>
                    {({ copied, copy }) => (
                      <ActionIcon
                        variant="subtle"
                        onClick={copy}
                        aria-label={t('family.invite.copyAria', 'Copy invite link')}
                      >
                        <Copy size={16} />
                      </ActionIcon>
                    )}
                  </CopyButton>
                </Group>
                <Text size="xs" c="dimmed">
                  {t(
                    'family.invite.expiryHint',
                    'This link expires after a few days. You can always create a new one.',
                  )}
                </Text>
              </Stack>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
