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
} from '@mantine/core';
import { IconRefresh, IconTrash, IconMessagePlus, IconSearch, IconMessage } from '@tabler/icons-react';

// --- tiny, safe toast fallback so we don't crash if your toast util isn't wired yet
const toast = {
  ok: (m) => console.log(m),
  err: (m) => console.error(m),
  info: (m) => console.info(m),
};

export default function ContactList({ currentUserId, onChanged }) {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);             // raw contacts from server
  const [nextCursor, setNextCursor] = useState(null); // server pagination cursor (optional)
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');           // local (saved contacts) filter

  async function fetchContacts({ cursor = null, append = false } = {}) {
    try {
      setLoading(true);

      const { data } = await axiosClient.get('/contacts', {
        params: { limit: 50, ...(cursor ? { cursor } : {}) },
      });

      const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      const nextList = append ? [...items, ...list] : list;

      setItems(nextList);
      setNextCursor(data?.nextCursor ?? null);
      onChanged?.(nextList);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
      toast.err('Failed to load contacts. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchContacts({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local saved-contacts filter (client-side)
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
        (c.userId ? `User #${c.userId}` : 'External contact');

      return (
        display.toLowerCase().includes(q) ||
        username.toLowerCase().includes(q) ||
        alias.toLowerCase().includes(q) ||
        String(c.externalPhone || '').toLowerCase().includes(q)
      );
    });
  }, [items, search]);

  const startChat = async (userId) => {
    try {
      if (!userId) {
        toast.info('That contact hasn’t joined Chatforia yet.');
        return;
      }
      const { data } = await axiosClient.post(`/chatrooms/direct/${userId}`);
      if (data?.id) navigate(`/chat/${data.id}`);
      else toast.err('Could not start chat. Please try again.');
    } catch (e) {
      console.error('Failed to start chat:', e);
      toast.err('Failed to start chat. Please try again.');
    }
  };

  const deleteContact = async (userId, externalPhone) => {
    try {
      await axiosClient.delete('/contacts', {
        data: userId ? { ownerId: currentUserId, userId } : { ownerId: currentUserId, externalPhone },
      });
      await fetchContacts({ append: false });
      toast.ok('Contact deleted.');
    } catch (err) {
      console.error('Failed to delete contact:', err);
      toast.err('Failed to delete contact. Please try again.');
    }
  };

  const updateAlias = async (userId, externalPhone, alias) => {
    try {
      await axiosClient.patch('/contacts', {
        ownerId: currentUserId,
        ...(userId ? { userId } : { externalPhone }),
        alias: alias || '',
      });
      toast.ok('Alias updated.');
    } catch (err) {
      console.error('Failed to update alias:', err);
      toast.err('Failed to update alias. Please try again.');
    } finally {
      await fetchContacts({ append: false });
    }
  };

  return (
    <Box p="md" maw={560} mx="auto">
      {/* Header row */}
      <Group justify="space-between" align="center" mb="xs">
        <Title order={4}>Saved Contacts</Title>
        <ActionIcon
          variant="subtle"
          onClick={() => fetchContacts({ append: false })}
          aria-label="Refresh contacts"
          title="Refresh"
        >
          <IconRefresh size={18} />
        </ActionIcon>
      </Group>

      {/* Compact local filter */}
      <TextInput
        placeholder="Filter saved contacts…"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        leftSection={<IconSearch size={16} />}
        aria-label="Filter saved contacts"
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
        <Text c="dimmed" size="sm">No contacts found.</Text>
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
              (c.userId ? `User #${c.userId}` : 'External contact');

            const secondary =
              c.alias && username && c.alias.toLowerCase() !== username.toLowerCase()
                ? username
                : (c.externalPhone && c.externalPhone !== displayName ? c.externalPhone : '');

            const goCompose = () =>
              navigate(`/sms/compose?to=${encodeURIComponent(c.externalPhone)}${c.alias ? `&name=${encodeURIComponent(c.alias)}` : ''}`);

            return (
              <Group key={key} justify="space-between" align="center">
                <button
                  type="button"
                  onClick={() => startChat(c.userId)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    background: 'none',
                    border: 0,
                    padding: 0,
                    cursor: c.userId ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>{displayName}</span>
                    {secondary ? (
                      <span style={{ fontSize: 12, opacity: 0.65 }}>{secondary}</span>
                    ) : null}
                  </div>
                </button>

                <TextInput
                  placeholder="Alias"
                  defaultValue={c.alias || ''}
                  size="xs"
                  maw={180}
                  onBlur={(e) =>
                    updateAlias(c.userId, c.externalPhone, e.currentTarget.value)
                  }
                />

                <Group gap="xs">
                  {/* Internal user → DM */}
                  {c.userId ? (
                    <Tooltip label="Start chat">
                      <ActionIcon
                        variant="light"
                        aria-label="Start chat"
                        onClick={() => startChat(c.userId)}
                      >
                        <IconMessagePlus size={16} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}

                  {/* External number → Compose SMS */}
                  {c.externalPhone ? (
                    <Tooltip label="Message">
                      <ActionIcon
                        variant="light"
                        aria-label="Message"
                        onClick={goCompose}
                      >
                        <IconMessage size={16} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}

                  <Tooltip label="Delete">
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label="Delete contact"
                      onClick={() => deleteContact(c.userId, c.externalPhone)}
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
          <Button
            variant="light"
            onClick={() => fetchContacts({ cursor: nextCursor, append: true })}
          >
            Load more
          </Button>
        </Group>
      )}
    </Box>
  );
}
