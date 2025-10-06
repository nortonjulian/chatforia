import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import ContactList from './ContactList';
import {
  Modal,
  TextInput,
  Button,
  Stack,
  Divider,
  Title,
  Group,
  Alert,
  ScrollArea,
  Text,
  Paper,
} from '@mantine/core';

// Ads
import AdSlot from '../ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';

// Premium gating
import useIsPremium from '@/hooks/useIsPremium';

function coerceUsers(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.results)) return payload.results;
  return [payload];
}

/**
 * StartChatModal
 *
 * Props:
 * - currentUserId: number (required)
 * - onClose: () => void
 * - initialQuery?: string      // seed from the page's global search
 * - hideSearch?: boolean       // set true to avoid a second search box in the modal
 */
export default function StartChatModal({
  currentUserId,
  onClose,
  initialQuery = '',
  hideSearch = false,
}) {
  const [query, setQuery] = useState(initialQuery);
  const [hasSearched, setHasSearched] = useState(false);

  const [results, setResults] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [aliasEdits, setAliasEdits] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [error, setError] = useState('');

  const [showContacts, setShowContacts] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [addAlias, setAddAlias] = useState('');
  const [adding, setAdding] = useState(false);

  const navigate = useNavigate();
  const isPremium = useIsPremium();

  // Initial contacts fetch (used by the "Show contacts" pane)
  useEffect(() => {
    axiosClient
      .get(`/contacts/${currentUserId}`)
      .then((res) =>
        setContacts(Array.isArray(res?.data) ? res.data : (res?.data?.items || []))
      )
      .catch(() => {});
  }, [currentUserId]);

  // Keep a map of saved contacts by userId (for alias prefills)
  const savedMap = useMemo(() => {
    const map = new Map();
    (contacts || []).forEach((c) => {
      if (c.userId) map.set(c.userId, c);
    });
    return map;
  }, [contacts]);

  // If parent passes a new initialQuery, sync it and (optionally) search
  useEffect(() => {
    setQuery(initialQuery || '');
    if (initialQuery?.trim()) {
      runSearch(initialQuery.trim());
    } else {
      setResults([]);
      setHasSearched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const runSearch = async (qStr) => {
    const q = (qStr ?? query).trim();
    setError('');
    setHasSearched(true);
    setResults([]);

    if (!q) return;

    setLoading(true);
    try {
      // Keep endpoint consistent with your API; this modal has historically used /users/search
      const res = await axiosClient.get('/users/search', { params: { query: q } });
      const arr = coerceUsers(res?.data);
      const cleaned = arr.filter((u) => u && u.id !== currentUserId);
      setResults(cleaned);

      const seed = {};
      cleaned.forEach((u) => {
        const saved = savedMap.get(u.id);
        if (saved?.alias) seed[u.id] = saved.alias;
      });
      setAliasEdits((prev) => ({ ...seed, ...prev }));
    } catch {
      setError('Failed to search users.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (user) => {
    setSavingId(user.id);
    setError('');
    try {
      await axiosClient.post('/contacts', {
        ownerId: currentUserId,
        userId: user.id,
        alias: aliasEdits[user.id] || undefined,
      });
    } catch {
      setError('Failed to save contact.');
    } finally {
      setSavingId(null);
    }
  };

  const handleUpdateAlias = async (user) => {
    setUpdatingId(user.id);
    setError('');
    try {
      await axiosClient.patch('/contacts', {
        ownerId: currentUserId,
        userId: user.id,
        alias: aliasEdits[user.id] || '',
      });
    } catch {
      setError('Failed to update alias.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (user) => {
    setDeletingId(user.id);
    setError('');
    try {
      await axiosClient.delete('/contacts', {
        data: { ownerId: currentUserId, userId: user.id },
      });
    } catch {
      setError('Failed to delete contact.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartChat = async (user) => {
    setStartingId(user.id);
    setError('');
    try {
      const chatRes = await axiosClient.post(`/chatrooms/direct/${user.id}`);
      const chatroom = chatRes?.data;
      onClose?.();
      if (chatroom?.id) navigate(`/chat/${chatroom.id}`);
    } catch {
      setError('Failed to start chat.');
    } finally {
      setStartingId(null);
    }
  };

  const isLikelyPhone = (s) => /\d/.test(s || '');

  const handleAddContactDirect = async () => {
    setError('');
    const raw = addValue.trim();
    if (!raw) return;
    setAdding(true);

    try {
      if (isLikelyPhone(raw)) {
        await axiosClient.post('/contacts', {
          ownerId: currentUserId,
          externalPhone: raw,
          externalName: addAlias || '',
          alias: addAlias || undefined,
        });
        axiosClient.post('/invites', { phone: raw, name: addAlias }).catch(() => {});
      } else {
        const res = await axiosClient.get('/users/search', { params: { query: raw } });
        const arr = coerceUsers(res?.data);
        const u = arr.find((x) => x && x.id !== currentUserId);

        if (u) {
          await axiosClient.post('/contacts', {
            ownerId: currentUserId,
            userId: u.id,
            alias: addAlias || undefined,
          });
        } else {
          await axiosClient.post('/contacts', {
            ownerId: currentUserId,
            externalPhone: raw,
            externalName: addAlias || '',
            alias: addAlias || undefined,
          });
          axiosClient.post('/invites', { phone: raw, name: addAlias }).catch(() => {});
        }
      }

      setAddValue('');
      setAddAlias('');
      setAddOpen(false);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Failed to add contact.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={<Title order={4}>Start a chat</Title>}
      radius="xl"
      centered
      size="lg"
      aria-label="Start a chat"
    >
      <Stack gap="sm">
        {/* Optional search row — hide to avoid redundancy with page-level search */}
        {!hideSearch && (
          <Group align="end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search by username or phone"
              aria-label="Search users"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
            <Button onClick={() => runSearch()} loading={!!loading}>
              Search
            </Button>
          </Group>
        )}

        {error && <Alert color="red">{error}</Alert>}

        {/* Results area */}
        {results.length > 0 ? (
          <Stack gap="xs">
            {results.map((u) => {
              const saved = savedMap.get(u.id);
              const busy =
                savingId === u.id ||
                updatingId === u.id ||
                deletingId === u.id ||
                startingId === u.id;

              return (
                <Paper key={u.id} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="center">
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Text fw={600} truncate>
                        {u.username}
                      </Text>
                      <Text c="dimmed" size="sm">
                        {u.phoneNumber || u.email || 'User'}
                      </Text>
                      <TextInput
                        placeholder="Alias (optional)"
                        value={aliasEdits[u.id] ?? (saved?.alias || '')}
                        onChange={(e) =>
                          setAliasEdits((prev) => ({
                            ...prev,
                            [u.id]: e.currentTarget.value,
                          }))
                        }
                        maw={280}
                      />
                    </Stack>

                    <Group wrap="nowrap">
                      {!saved ? (
                        <Button
                          variant="light"
                          loading={savingId === u.id}
                          onClick={() => handleSave(u)}
                          disabled={busy}
                        >
                          Save
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="light"
                            loading={updatingId === u.id}
                            onClick={() => handleUpdateAlias(u)}
                            disabled={busy}
                          >
                            Update
                          </Button>
                          <Button
                            color="red"
                            variant="light"
                            loading={deletingId === u.id}
                            onClick={() => handleDelete(u)}
                            disabled={busy}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                      <Button
                        loading={startingId === u.id}
                        onClick={() => handleStartChat(u)}
                        disabled={busy}
                      >
                        Start
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              );
            })}

            {!isPremium && (
              <div style={{ marginTop: 8 }}>
                <AdSlot placement={PLACEMENTS.SEARCH_RESULTS_FOOTER} />
              </div>
            )}
          </Stack>
        ) : (
          <>
            {hasSearched ? (
              <Text c="dimmed">No results</Text>
            ) : (
              hideSearch ? (
                <Text c="dimmed">Use the page search to find people, or pick from contacts below.</Text>
              ) : (
                <Text c="dimmed">Type a username or phone and press Search.</Text>
              )
            )}
          </>
        )}

        {/* Pick from contacts */}
        <Group justify="center">
          <Divider label="Or pick from contacts" labelPosition="center" my="xs" />
          {!showContacts && (
            <Button
              variant="light"
              onClick={() => setShowContacts(true)}
              aria-label="Show contacts"
            >
              Show
            </Button>
          )}
        </Group>

        {showContacts && (
          <ScrollArea style={{ maxHeight: 300 }}>
            <ContactList currentUserId={currentUserId} onChanged={setContacts} />
          </ScrollArea>
        )}

        {/* Add a contact directly */}
        <Divider label="Add a Contact" labelPosition="center" my="xs" />

        {!addOpen ? (
          <Group justify="flex-start">
            <Button type="button" onClick={() => setAddOpen(true)}>
              Add
            </Button>
          </Group>
        ) : (
          <Group align="end" wrap="wrap">
            <TextInput
              style={{ flex: 1, minWidth: 240 }}
              placeholder="Username or phone"
              value={addValue}
              onChange={(e) => setAddValue(e.currentTarget.value)}
            />
            <TextInput
              style={{ flex: 1, minWidth: 200 }}
              placeholder="Alias (optional)"
              value={addAlias}
              onChange={(e) => setAddAlias(e.currentTarget.value)}
            />
            <Button loading={adding} onClick={handleAddContactDirect}>
              Save Contact
            </Button>
            <Button
              variant="light"
              color="gray"
              onClick={() => {
                setAddValue('');
                setAddAlias('');
                setAddOpen(false);
              }}
            >
              Cancel
            </Button>
          </Group>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={onClose}>
            Close
          </Button>
        </Group>

        {!isPremium && (
          <div style={{ marginTop: 8 }}>
            <AdSlot placement={PLACEMENTS.START_CHAT_MODAL_FOOTER} />
          </div>
        )}
      </Stack>
    </Modal>
  );
}
