import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Avatar,
  Group,
  ScrollArea,
  Text,
  Tooltip,
  Loader,
} from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import { useSocket } from '@/context/SocketContext';
import { decryptFetchedMessages } from '@/utils/encryptionClient';

export default function StatusBar({ currentUserId, onOpenViewer }) {
  const { socket } = useSocket();
  const [items, setItems] = useState([]); // [{id, author, assets[], captionCiphertext, encryptedKeyForMe, viewerSeen, ...}]
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    let alive = true;
    setLoading(true);
    try {
      const { data } = await axiosClient.get('/status/feed');
      const list = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
        ? data
        : [];

      // Prepare minimal messages for decryption
      const fakeMsgs = list.map((s) => ({
        id: s.id,
        contentCiphertext: s.captionCiphertext,
        encryptedKeyForMe: s.encryptedKeyForMe,
        sender: { id: s.author?.id, username: s.author?.username },
      }));

      const needsDecrypt = fakeMsgs.some(
        (m) => m.contentCiphertext && m.encryptedKeyForMe
      );

      const decrypted = needsDecrypt
        ? await decryptFetchedMessages(fakeMsgs, currentUserId)
        : [];

      const map = new Map(decrypted.map((m) => [m.id, m.decryptedContent]));

      if (!alive) return;
      setItems(
        list.map((s) => ({
          ...s,
          caption: map.get(s.id) || '',
        }))
      );
    } catch (e) {
      console.error('status feed failed', e);
      if (!alive) return;
      setItems([]);
    } finally {
      if (alive) setLoading(false);
    }
    return () => {
      alive = false;
    };
  }, [currentUserId]);

  // Initial load / when user changes
  useEffect(() => {
    load();
  }, [load]);

  // Live updates from socket
  useEffect(() => {
    if (!socket) return;

    const onPosted = () => load();
    const onExpired = () => load();
    const onDeleted = () => load();
    const onViewed = ({ statusId }) => {
      setItems((prev) =>
        prev.map((s) => (s.id === statusId ? { ...s, viewerSeen: true } : s))
      );
    };

    socket.on('status_posted', onPosted);
    socket.on('status_expired', onExpired);
    socket.on('status_deleted', onDeleted);
    socket.on('status_viewed', onViewed);

    return () => {
      socket.off('status_posted', onPosted);
      socket.off('status_expired', onExpired);
      socket.off('status_deleted', onDeleted);
      socket.off('status_viewed', onViewed);
    };
  }, [socket, load]);

  // Group by author and sort: unseen first, then most recent
  const authors = useMemo(() => {
    const by = new Map();
    for (const s of items) {
      const key = s.author?.id;
      if (!by.has(key)) by.set(key, { author: s.author, list: [] });
      by.get(key).list.push(s);
    }
    const arr = Array.from(by.values());
    arr.sort((a, b) => {
      const aUnseen = a.list.some((s) => !s.viewerSeen);
      const bUnseen = b.list.some((s) => !s.viewerSeen);
      if (aUnseen !== bUnseen) return aUnseen ? -1 : 1;
      const aMax = Math.max(...a.list.map((s) => new Date(s.createdAt).getTime() || 0));
      const bMax = Math.max(...b.list.map((s) => new Date(s.createdAt).getTime() || 0));
      return bMax - aMax;
    });
    return arr;
  }, [items]);

  if (loading && !items.length) {
    return (
      <Group gap="xs" p="xs">
        <Loader size="xs" />
        <Text c="dimmed">Loading status…</Text>
      </Group>
    );
  }

  if (!authors.length) return null;

  return (
    <ScrollArea
      type="never"
      style={{ borderBottom: '1px solid var(--mantine-color-gray-3)', maxHeight: 104 }}
    >
      <Group gap="md" p="xs" wrap="nowrap" style={{ overflowX: 'auto' }}>
        {authors.map(({ author, list }) => {
          const unseen = list.some((s) => !s.viewerSeen);
          const label = `${author?.username} — ${list.length} post${
            list.length > 1 ? 's' : ''
          }${unseen ? ' — new' : ''}`;

          return (
            <Tooltip key={author?.id} label={label}>
              <div
                role="button"
                tabIndex={0}
                aria-label={`Open stories from ${author?.username}${unseen ? ', new items' : ''}`}
                onClick={() => onOpenViewer?.({ author, stories: list })}
                onKeyDown={(e) =>
                  (e.key === 'Enter' || e.key === ' ') &&
                  onOpenViewer?.({ author, stories: list })
                }
                style={{ cursor: 'pointer', textAlign: 'center' }}
              >
                <div
                  style={{
                    padding: 2,
                    borderRadius: '50%',
                    border: unseen
                      ? '2px solid var(--mantine-color-orbit-6, var(--mantine-primary-color-filled))'
                      : '2px solid transparent',
                  }}
                >
                  <Avatar
                    src={author?.avatarUrl || '/default-avatar.png'}
                    radius="xl"
                    size="lg"
                  />
                </div>
                <Text size="xs" mt={4} lineClamp={1} style={{ maxWidth: 64 }}>
                  {author?.username}
                </Text>
              </div>
            </Tooltip>
          );
        })}
      </Group>
    </ScrollArea>
  );
}
