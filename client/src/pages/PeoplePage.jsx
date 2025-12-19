import { useEffect, useRef, useState } from 'react';
import {
  Title,
  Group,
  Button,
  Paper,
  TextInput,
  ActionIcon,
  Box,
  Grid,
  Stack,
  Text,
  Divider,
  CopyButton,
  Tooltip,
} from '@mantine/core';
import { IconSearch, IconX, IconCopy, IconCheck, IconDeviceMobile } from '@tabler/icons-react';
import { useUser } from '../context/UserContext';
import NewConversationModal from '@/components/NewConversationModal';
import ContactList from '../components/ContactList';
import ImportContactsModal from '@/components/ImportContactsModal';
import { useTranslation } from 'react-i18next';

export default function PeoplePage() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [openStartChat, setOpenStartChat] = useState(false);
  const [openImport, setOpenImport] = useState(false);

  // global search state (for the row above the card)
  const [q, setQ] = useState('');
  const [input, setInput] = useState('');

  // 👇 authoritative global search input reference
  const globalSearchRef = useRef(null);

  useEffect(() => {
    // Optional: preload from URL ?q=
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('q') || '';
    if (initial) {
      setInput(initial);
      setQ(initial);
    }
  }, []);

  if (!currentUser) return null;

  const applySearch = () => {
    const next = input.trim();
    setQ(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('q', next);
    else url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
  };

  const clearSearch = () => {
    setInput('');
    setQ('');
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
    globalSearchRef.current?.focus();
  };

  // Right-rail shortcut → focus/scroll to the ONE global search
  const focusGlobalSearch = () => {
    const el = globalSearchRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.focus(), 160); // let the scroll finish
  };

  // simple invite URL (adjust to your real invite flow if needed)
  const inviteUrl = `${window.location.origin}/join`;

  return (
    // Page column: centered container with a sensible cap
    <Box w="100%" mx="auto" px="md" style={{ maxWidth: 1200 }}>
      {/* Header row: title left, global actions right */}
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t('peoplePage.people', 'People')}</Title>
        {/* No header buttons — “+” in sidebar is the universal entry point */}
      </Group>

      <Grid align="start" gutter="lg">
        {/* LEFT: main content */}
        <Grid.Col span={{ base: 12, lg: 8 }}>
          {/* Global search row (capped so it never looks comically wide) */}
          <Box w="100%" mb="sm" mx={0} style={{ maxWidth: 640 }}>
            <Group wrap="nowrap" gap="sm" align="center">
              <TextInput
                id="global-people-search"
                aria-label={t('peoplePage.search', 'Search')}
                placeholder={t(
                  'peoplePage.searchPlaceholder',
                  'Search by alias, name, username, or phone'
                )}
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                leftSection={<IconSearch size={16} />}
                rightSection={
                  input ? (
                    <ActionIcon
                      aria-label={t('common.cancel', 'Cancel')}
                      onClick={clearSearch}
                      variant="subtle"
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  ) : null
                }
                inputRef={globalSearchRef}
                style={{ flex: '1 1 auto', minWidth: 0 }}
              />
              <Button onClick={applySearch} style={{ flex: '0 0 auto' }} w={120}>
                {t('peoplePage.search', 'Search')}
              </Button>
            </Group>
          </Box>

          {/* Main card */}
          <Paper withBorder radius="xl" p="md">
            {/* Note: ContactList currently ignores searchQuery; safe to pass for future support */}
            <ContactList currentUserId={currentUser.id} searchQuery={q} />
          </Paper>
        </Grid.Col>

        {/* RIGHT: helpful aside (hidden on mobile, shown >= lg) */}
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md" visibleFrom="lg">
            {/* Quick start/checklist */}
            <Paper withBorder radius="lg" p="md">
              <Text fw={600} mb="xs">
                {t('peoplePage.quickStart', 'Quick start')}
              </Text>
              <Text size="sm" c="dimmed" mb="sm">
                {t('peoplePage.quickStartDesc', 'A few fast ways to get rolling.')}
              </Text>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm">{t('peoplePage.importContacts', 'Import your contacts')}</Text>
                  <Button size="xs" variant="light" onClick={() => setOpenImport(true)}>
                    {t('peoplePage.import', 'Import')}
                  </Button>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t('peoplePage.findOrAdd', 'Find or add someone')}</Text>
                  <Button size="xs" onClick={() => setOpenStartChat(true)}>
                    {t('peoplePage.add', 'Add')}
                  </Button>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t('peoplePage.searchByPhoneOrUsername', 'Search by phone / username')}</Text>
                  <Button size="xs" variant="subtle" onClick={focusGlobalSearch}>
                    {t('peoplePage.focusSearch', 'Focus Search')}
                  </Button>
                </Group>
              </Stack>
            </Paper>

            {/* Invite friends */}
            <Paper withBorder radius="lg" p="md">
              <Text fw={600} mb="xs">{t('peoplePage.inviteFriends', 'Invite friends')}</Text>
              <Text size="sm" c="dimmed">
                {t('peoplePage.inviteDesc', 'Share your invite link to start chatting instantly.')}
              </Text>
              <Group mt="sm" wrap="nowrap">
                <Text
                  size="sm"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                >
                  {inviteUrl}
                </Text>
                <CopyButton value={inviteUrl} timeout={1600}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? t('common.copied', 'Copied!') : t('common.copy', 'Copy')} withArrow>
                      <ActionIcon variant="light" onClick={copy} aria-label={t('common.copy', 'Copy')}>
                        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
            </Paper>

            {/* Get the app */}
            <Paper withBorder radius="lg" p="md">
              <Text fw={600} mb="xs">{t('peoplePage.getTheApp', 'Get the app')}</Text>
              <Text size="sm" c="dimmed">
                {t('peoplePage.getTheAppDesc', 'Stay in touch on the go with Chatforia for iOS and Android.')}
              </Text>
              <Group mt="sm" gap="xs">
                <Button
                  variant="light"
                  leftSection={<IconDeviceMobile size={16} />}
                  component="a"
                  href="/download"
                >
                  {t('peoplePage.download', 'Download')}
                </Button>
              </Group>
              <Divider my="sm" />
              <Text size="xs" c="dimmed">
                {t('peoplePage.syncTip', 'Tip: Your messages stay synced across web and mobile.')}
              </Text>
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>

      {openStartChat && (
        <NewConversationModal currentUserId={currentUser.id} onClose={() => setOpenStartChat(false)} />
      )}

      <ImportContactsModal
        opened={openImport}
        onClose={() => setOpenImport(false)}
        defaultCountry="US"
      />
    </Box>
  );
}
