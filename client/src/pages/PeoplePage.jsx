import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
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
  Loader,
  Alert,
} from '@mantine/core';
import { IconSearch, IconX, IconCopy, IconCheck, IconDeviceMobile } from '@tabler/icons-react';
import { useUser } from '../context/UserContext';
import ContactList from '../components/ContactList';
import ImportContactsModal from '@/components/ImportContactsModal';
import AddContactModal from '@/components/AddContactModal';
import axiosClient from '@/api/axiosClient';
import { useTranslation } from 'react-i18next';

export default function PeoplePage() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const currentUserId = currentUser?.id;
  const navigate = useNavigate();

  const [openImport, setOpenImport] = useState(false);
  const [openAddContact, setOpenAddContact] = useState(false);
  const [q, setQ] = useState('');
  const [input, setInput] = useState('');
  const [peopleResults, setPeopleResults] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');

  const globalSearchRef = useRef(null);
  const [contactsRefreshKey, setContactsRefreshKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('q') || '';
    if (initial) {
      setInput(initial);
      setQ(initial);
    }
  }, []);

  useEffect(() => {
    if (!currentUserId || q.trim().length < 3) {
      setPeopleResults([]);
      setPeopleError('');
      setPeopleLoading(false);
      return undefined;
    }

    let cancelled = false;
    const run = async () => {
      setPeopleLoading(true);
      setPeopleError('');
      try {
        const { data } = await axiosClient.get('/search/people', {
          params: { q: q.trim(), limit: 12 },
        });
        if (cancelled) return;
        setPeopleResults(
          (data?.items || []).filter(
            (item) =>
              item.kind === 'user' &&
              item.userId &&
              Number(item.userId) !== Number(currentUserId)
          )
        );
      } catch (error) {
        if (!cancelled) {
          setPeopleResults([]);
          setPeopleError(
            error?.response?.data?.error ||
              'Could not search Chatforia users.'
          );
        }
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [q, currentUserId]);

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
    setPeopleResults([]);
    setPeopleError('');
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
    globalSearchRef.current?.focus();
  };

  const startDirectChat = async (userId) => {
    try {
      setPeopleError('');
      const { data } = await axiosClient.post(`/chatrooms/direct/${userId}`);
      const roomId = data?.id ?? data?.chatRoomId ?? data?.roomId;
      if (!roomId) throw new Error('Could not open chat.');
      navigate(`/chat/${roomId}`);
    } catch (error) {
      setPeopleError(
        error?.response?.data?.error ||
          error?.message ||
          t('peoplePage.chatOpenFailed', 'Could not open this chat.')
      );
    }
  };

  const inviteUrl = `${window.location.origin}/join`;

  return (
    <Box w="100%" mx="auto" px="md" style={{ maxWidth: 1200 }}>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t('peoplePage.people', 'People')}</Title>
      </Group>

      <Grid align="start" gutter="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Box w="100%" mb="sm" mx={0} style={{ maxWidth: 640 }}>
            <Group wrap="nowrap" gap="sm" align="center">
              <TextInput
                id="global-people-search"
                aria-label={t('peoplePage.search', 'Search')}
                placeholder={t(
                  'peoplePage.searchPlaceholder',
                  'Search contacts or Chatforia users by name, username, or phone'
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

          {q && q.trim().length < 3 ? (
            <Text size="sm" c="dimmed" mb="sm">
              {t('peoplePage.searchMinChars', 'Enter at least 3 characters to search Chatforia users.')}
            </Text>
          ) : null}

          {peopleLoading ? <Loader size="sm" mb="sm" /> : null}
          {peopleError ? <Alert color="red" mb="sm">{peopleError}</Alert> : null}

          {q.trim().length >= 3 && peopleResults.length > 0 ? (
            <Paper withBorder radius="xl" p="md" mb="md">
              <Text fw={700} mb="sm">
                {t('peoplePage.chatforiaUsers', 'Chatforia users')}
              </Text>
              <Stack gap="xs">
                {peopleResults.map((person) => (
                  <Group key={`user:${person.userId}`} justify="space-between" wrap="nowrap">
                    <Group wrap="nowrap" style={{ minWidth: 0 }}>
                      <Avatar src={person.avatarUrl || undefined} radius="xl">
                        {(person.displayName || person.username || '?').slice(0, 1).toUpperCase()}
                      </Avatar>
                      <div style={{ minWidth: 0 }}>
                        <Text fw={600} truncate>
                          {person.displayName || person.label || person.username}
                        </Text>
                        <Text size="sm" c="dimmed" truncate>
                          @{person.username}
                        </Text>
                      </div>
                    </Group>
                    <Button size="xs" onClick={() => startDirectChat(person.userId)}>
                      {t('peoplePage.message', 'Message')}
                    </Button>
                  </Group>
                ))}
              </Stack>
            </Paper>
          ) : null}

          <Paper withBorder radius="xl" p="md">
            <ContactList
              key={contactsRefreshKey}
              currentUserId={currentUserId}
              searchQuery={q}
            />
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md" visibleFrom="lg">
            <Paper withBorder radius="lg" p="md">
              <Text fw={600} mb="xs">
                {t('peoplePage.quickStart', 'Quick start')}
              </Text>
              <Text size="sm" c="dimmed" mb="sm">
                {t('peoplePage.quickStartDesc', 'Manage your contacts and invite friends.')}
              </Text>

              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm">{t('peoplePage.importContacts', 'Import your contacts')}</Text>
                  <Button size="xs" variant="light" onClick={() => setOpenImport(true)}>
                    {t('peoplePage.import', 'Import')}
                  </Button>
                </Group>

                <Group justify="space-between">
                  <Text size="sm">{t('peoplePage.addContact', 'Add a contact')}</Text>
                  <Button size="xs" onClick={() => setOpenAddContact(true)}>
                    {t('peoplePage.add', 'Add')}
                  </Button>
                </Group>
              </Stack>
            </Paper>

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

      <AddContactModal
        opened={openAddContact}
        onClose={() => setOpenAddContact(false)}
        currentUserId={currentUserId}
        onAdded={() => setContactsRefreshKey((k) => k + 1)}
      />

      <ImportContactsModal
        opened={openImport}
        onClose={() => setOpenImport(false)}
        defaultCountry="US"
        onImported={() => setContactsRefreshKey((k) => k + 1)}
      />
    </Box>
  );
}
