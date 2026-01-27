import { useEffect, useMemo, useState } from 'react';
import axiosClient from '../api/axiosClient';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Title,
  TextInput,
  Stack,
  Text,
  Button,
  Group,
  ActionIcon,
  Skeleton,
  Tooltip,
  Checkbox,
} from '@mantine/core';
import {
  IconRefresh,
  IconTrash,
  IconSearch,
  IconMessage,
  IconPhoneCall,
  IconVideo,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

// --- tiny, safe toast fallback so we don't crash if your toast util isn't wired yet
const toast = {
  ok: (m) => console.log(m),
  err: (m) => console.error(m),
  info: (m) => console.info(m),
};

// ✅ normalize for safer URL params
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/[^\d+]/g, '');
}

export default function ContactList({
  currentUserId,
  onChanged,
  selectionMode = 'single', // 'single' | 'multiple'
  selectedIds = [],         // string[]
  onToggleSelect,           // (id: string) => void
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function fetchContacts({ cursor = null, append = false } = {}) {
    try {
      setLoading(true);

      const { data } = await axiosClient.get('/contacts', {
        params: { limit: 50, ...(cursor ? { cursor } : {}) },
      });

      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
          ? data.items
          : [];

      const nextList = append ? [...items, ...list] : list;

      setItems(nextList);
      setNextCursor(data?.nextCursor ?? null);
      onChanged?.(nextList);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
      toast.err(t('contactList.loadFailed', 'Failed to load contacts. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchContacts({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;

    return items.filter((c) => {
      const username = c.user?.username || '';
      const alias = c.alias || '';
      const display =
        alias ||
        username ||
        c.externalName ||
        c.externalPhone ||
        (c.userId
          ? t('status.userNumber', 'User #{{id}}', { id: c.userId })
          : t('contactList.externalContact', 'External contact'));

      return (
        display.toLowerCase().includes(q) ||
        username.toLowerCase().includes(q) ||
        alias.toLowerCase().includes(q) ||
        String(c.externalPhone || '').toLowerCase().includes(q)
      );
    });
  }, [items, search, i18n.language, t]);

  const startChat = async (userId) => {
    try {
      if (!userId) {
        toast.info(t('contactList.notJoined', 'That contact hasn’t joined Chatforia yet.'));
        return;
      }

      const { data } = await axiosClient.post(`/chatrooms/direct/${userId}`);

      const chatroomId =
        data?.id ?? data?.chatroomId ?? data?.roomId ?? data?.chatRoomId ?? null;

      if (chatroomId) navigate(`/chat/${chatroomId}`);
      else toast.err(t('contactList.couldNotStart', 'Could not start chat. Please try again.'));
    } catch (e) {
      console.error('Failed to start chat:', e);
      toast.err(t('contactList.startFailed', 'Failed to start chat. Please try again.'));
    }
  };

  const deleteContact = async (userId, externalPhone) => {
    try {
      await axiosClient.delete('/contacts', {
        data: userId
          ? { ownerId: currentUserId, userId }
          : { ownerId: currentUserId, externalPhone },
      });

      await fetchContacts({ append: false });
      toast.ok(t('contactList.deleted', 'Contact deleted.'));
    } catch (err) {
      console.error('Failed to delete contact:', err);
      toast.err(t('contactList.deleteFailed', 'Failed to delete contact. Please try again.'));
    }
  };

  const updateAlias = async (userId, externalPhone, alias) => {
    try {
      await axiosClient.patch('/contacts', {
        ownerId: currentUserId,
        ...(userId ? { userId } : { externalPhone }),
        alias: alias || '',
      });
      toast.ok(t('contactList.aliasUpdated', 'Alias updated.'));
    } catch (err) {
      console.error('Failed to update alias:', err);
      toast.err(t('contactList.updateAliasFailed', 'Failed to update alias. Please try again.'));
    } finally {
      await fetchContacts({ append: false });
    }
  };

  /**
   * ✅ CALL / VIDEO routing:
   * Your Dialer/Video pages should be driven by `?to=E164...`
   * (NOT `userId=...`)
   */
  const goCall = ({ userId, phone }) => {
  if (userId) return navigate(`/dialer?userId=${encodeURIComponent(userId)}`);
  const to = normalizePhone(phone);
  if (!to) return toast.info('No callable number');
  navigate(`/dialer?to=${encodeURIComponent(to)}`);
};

  const goVideo = ({ userId }) => {
    if (!userId) return toast.info(t('contactList.videoRequiresAccount', 'Video requires a Chatforia account'));
    navigate(`/video?userId=${encodeURIComponent(userId)}`);
  };

  const openSmsThreadOrCompose = async ({ phone, alias }) => {
    if (!phone) return;

    const to = String(phone).trim();

    try {
      const { data } = await axiosClient.get('/sms/threads/lookup', {
        params: { to },
      });

      const threadId = data?.threadId ?? null;

      if (threadId) {
        navigate(`/sms/${threadId}`);
        return;
      }

      navigate(
        `/sms/compose?to=${encodeURIComponent(to)}${
          alias ? `&name=${encodeURIComponent(alias)}` : ''
        }`
      );
    } catch (e) {
      console.error('Failed to lookup SMS thread:', e);
      // fallback to compose
      navigate(
        `/sms/compose?to=${encodeURIComponent(to)}${
          alias ? `&name=${encodeURIComponent(alias)}` : ''
        }`
      );
    }
  };

  return (
    <Box p="md" maw={560} mx="auto">
      <Group justify="space-between" align="center" mb="xs">
        <Title order={4}>{t('contactList.savedContacts', 'Saved Contacts')}</Title>
        <ActionIcon
          variant="subtle"
          onClick={() => fetchContacts({ append: false })}
          aria-label={t('contactList.refreshAria', 'Refresh contacts')}
          title={t('common.refresh', 'Refresh')}
        >
          <IconRefresh size={18} />
        </ActionIcon>
      </Group>

      <TextInput
        placeholder={t('contactList.filterPlaceholder', 'Filter saved contacts…')}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        leftSection={<IconSearch size={16} />}
        aria-label={t('contactList.filterAria', 'Filter saved contacts')}
        size="sm"
        mb="md"
        styles={{ input: { maxWidth: 360 } }}
      />

      {loading && items.length === 0 ? (
        <Stack>
          <Skeleton h={52} />
          <Skeleton h={52} />
        </Stack>
      ) : filteredItems.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('contactList.noContactsFound', 'No contacts found.')}
        </Text>
      ) : (
        <Stack gap="xs">
          {filteredItems.map((c) => {
            const key = c.id ?? `${c.userId ?? c.externalPhone ?? Math.random()}`;
            const username = c.user?.username || '';

            const displayName =
              c.alias ||
              username ||
              c.externalName ||
              c.externalPhone ||
              (c.userId
                ? t('status.userNumber', 'User #{{id}}', { id: c.userId })
                : t('contactList.externalContact', 'External contact'));

            const secondary =
              c.alias &&
              username &&
              c.alias.toLowerCase() !== username.toLowerCase()
                ? username
                : c.externalPhone && c.externalPhone !== displayName
                  ? c.externalPhone
                  : '';

            const selectableId = c.userId || c.externalPhone || key;
            const isMultiple = selectionMode === 'multiple';
            const checked = isMultiple ? selectedIds.includes(selectableId) : false;

            const handleRowPrimaryClick = () => {
              if (isMultiple) {
                onToggleSelect?.(selectableId);
                return;
              }
              // Click row: if Chatforia user -> DM
              if (c.userId) startChat(c.userId);
            };

            const handleMessageClick = () => {
              // ✅ if joined user -> DM
              if (c.userId) return startChat(c.userId);

              // ✅ else SMS
              if (c.externalPhone) return openSmsThreadOrCompose({ phone: c.externalPhone, alias: c.alias });
              toast.info(t('contactList.noRoute', 'No message route for this contact.'));
            };

            const canVideo = Boolean(c.userId); 
            const videoTooltip = canVideo
              ? t('contactList.video', 'Video')
              : t('contactList.videoRequiresAccount', 'Video requires a Chatforia account');

            return (
              <Group key={key} justify="space-between" align="center">
                <button
                  type="button"
                  onClick={handleRowPrimaryClick}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    background: 'none',
                    border: 0,
                    padding: 0,
                    cursor: isMultiple ? 'pointer' : (c.userId ? 'pointer' : 'default'),
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {isMultiple && (
                      <Checkbox
                        checked={checked}
                        onChange={() => onToggleSelect?.(selectableId)}
                        aria-label={`${t('contactList.selectContactPrefix', 'Select')} ${displayName}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName}
                      </span>
                      {secondary ? (
                        <span style={{ fontSize: 12, opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {secondary}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>

                <TextInput
                  placeholder={t('contactList.alias', 'Alias')}
                  defaultValue={c.alias || ''}
                  size="xs"
                  maw={180}
                  onBlur={(e) => updateAlias(c.userId, c.externalPhone, e.currentTarget.value)}
                />

                <Group gap="xs">
                  <Tooltip label={t('contactList.message', 'Message')}>
                    <ActionIcon
                      variant="light"
                      aria-label={t('contactList.message', 'Message')}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleMessageClick();
                      }}
                    >
                      <IconMessage size={16} />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip label={t('contactList.call', 'Call')}>
                    <ActionIcon
                      variant="light"
                      aria-label={t('contactList.call', 'Call')}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        goCall({ userId: c.userId, phone: c.externalPhone });
                      }}
                    >
                      <IconPhoneCall size={16} />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip label={videoTooltip} withArrow>
                    <span style={{ display: 'inline-flex' }}>
                      <ActionIcon
                        variant="light"
                        aria-label={t('contactList.video', 'Video')}
                        disabled={!canVideo}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!canVideo) return;
                          goVideo({ userId: c.userId });
                        }}
                      >
                        <IconVideo size={16} />
                      </ActionIcon>
                    </span>
                  </Tooltip>

                  <Tooltip label={t('contactList.delete', 'Delete')}>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label={t('contactList.deleteContactAria', 'Delete contact')}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteContact(c.userId, c.externalPhone);
                      }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            );
          })}
        </Stack>
      )}

      {nextCursor && (
        <Group justify="center" mt="md">
          <Button variant="light" onClick={() => fetchContacts({ cursor: nextCursor, append: true })}>
            {t('contactList.loadMore', 'Load more')}
          </Button>
        </Group>
      )}
    </Box>
  );
}
