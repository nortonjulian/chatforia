import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Paper, Title, Text, Button, Group, Loader, TextInput, Stack, Badge, Card
} from '@mantine/core';
import { IconMessageCircle, IconPlayerPlay, IconPlayerStop, IconRobot } from '@tabler/icons-react';
import { useUser } from '@/context/UserContext';
import { useNavigate } from 'react-router-dom';
import socket from '@/lib/socket'; // singleton client

export default function RandomChatPage() {
  const { currentUser } = useUser();
  const navigate = useNavigate();

  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(null); // { roomId, partner, partnerId, isAI? }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  // Tracks whether the *next* pair_found is for the AI flow
  const aiRequestedRef = useRef(false);

  /* ---------- Socket listeners ---------- */
  useEffect(() => {
    if (!socket) return;

    const onPairFound = (payload) => {
      const isAI =
        aiRequestedRef.current ||
        payload?.isAI === true ||
        /bot|ai/i.test(String(payload?.partner || ''));

      const normalized = isAI
        ? { ...payload, isAI: true, partner: 'Foria' }
        : payload;

      aiRequestedRef.current = false;
      setActive(normalized);
      setSearching(false);
      setStatus('');
      setMessages([]);
    };

    const onReceiveMessage = (msg) => setMessages((p) => [...p, msg]);
    const onPartnerDisconnected = (txt) =>
      setStatus(txt || 'Your partner disconnected.');
    const onChatSkipped = (txt) => {
      setSearching(false);
      setActive(null);
      setStatus(txt || 'Stopped.');
    };

    socket.on('pair_found', onPairFound);
    socket.on('receive_message', onReceiveMessage);
    socket.on('partner_disconnected', onPartnerDisconnected);
    socket.on('chat_skipped', onChatSkipped);

    return () => {
      socket.off('pair_found', onPairFound);
      socket.off('receive_message', onReceiveMessage);
      socket.off('partner_disconnected', onPartnerDisconnected);
      socket.off('chat_skipped', onChatSkipped);
    };
  }, []);

  /* ---------- Actions ---------- */
  const startSearch = () => {
    if (!socket || !currentUser) return;
    aiRequestedRef.current = false;
    setSearching(true);
    setStatus('Looking for someone…');
    socket.emit('find_random_chat');
  };

  const startAIChat = () => {
    if (!socket) return;
    aiRequestedRef.current = true;
    setSearching(true);
    setStatus('Starting a chat with Foria…');
    socket.emit('start_ai_chat');
  };

  const sendMessage = () => {
    if (!socket || !active || !draft.trim()) return;
    socket.emit('send_message', {
      content: draft.trim(),
      randomChatRoomId: active.roomId,
    });
    setDraft('');
  };

  // ✅ central cancel/reset (used by Close + Cancel + unmount)
  const cancelAll = useCallback(() => {
    setSearching(false);
    setActive(null);
    setMessages([]);
    setStatus('Cancelled.');
    aiRequestedRef.current = false;
    try {
      socket?.emit?.('skip_random_chat');
    } catch {
      // ignore; local UI already reset
    }
  }, []);

  // ESC = Cancel
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') cancelAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelAll]);

  // 🧹 Clean up server state if user navigates away from /random
  useEffect(() => {
    return () => {
      try {
        socket?.emit?.('skip_random_chat');
      } catch {}
    };
  }, []);

  const partnerLabel =
    active?.isAI ? 'Foria' : String(active?.partner ?? 'Partner');

  // 🚪 Close button: cancel + navigate home
  const closePage = () => {
    cancelAll();
    navigate('/');
  };

  return (
    <Paper withBorder radius="xl" p="lg" maw={720} mx="auto">
      <Group justify="space-between" align="center">
        <Title order={3}>Random Chat</Title>

        <Group gap="xs">
          {active ? (
            <Badge color={active.isAI ? 'grape' : 'green'} variant="light">
              {active.isAI ? 'With Foria' : 'Connected'}
            </Badge>
          ) : searching ? (
            <Badge color="blue" variant="light">Searching…</Badge>
          ) : (
            <Badge color="gray" variant="light">Idle</Badge>
          )}

          {/* New Close button */}
          <Button variant="subtle" color="gray" size="xs" onClick={closePage}>
            Close
          </Button>
        </Group>
      </Group>

      {!active && (
        <Stack mt="md">
          <Text c="dimmed">
            Meet someone new instantly. We’ll match you and open a temporary chat room.
          </Text>

          {/* Button row: centered block, left-aligned buttons */}
          <Group
            maw={560}
            mx="auto"
            justify="flex-start"
            wrap="wrap"
            gap="md"
          >
            <Button onClick={startSearch} leftSection={<IconPlayerPlay size={16} />}>
              {searching ? 'Finding…' : 'Find me a match'}
            </Button>

            <Button
              variant="light"
              color="gray"
              onClick={cancelAll}
              leftSection={<IconPlayerStop size={16} />}
            >
              Cancel
            </Button>

            <Button
              variant="subtle"
              leftSection={<IconRobot size={16} />}
              onClick={startAIChat}
            >
              Chat with Foria
            </Button>
          </Group>

          {status && (
            <Text c="dimmed">
              {searching && <Loader size="xs" style={{ marginRight: 6 }} />}
              {status}
            </Text>
          )}
        </Stack>
      )}

      {active && (
        <Stack mt="lg" gap="sm">
          <Card withBorder radius="lg" p="sm">
            <Group justify="space-between">
              <Group>
                <IconMessageCircle size={16} />
                <Text fw={600}>
                  You’re chatting with {partnerLabel}
                </Text>
                {active.isAI && <Badge size="xs" variant="light">BOT</Badge>}
              </Group>
              <Button color="red" variant="light" size="xs" onClick={cancelAll}>
                Leave
              </Button>
            </Group>
          </Card>

          <div
            style={{
              border: '1px solid var(--mantine-color-gray-3)',
              borderRadius: 12,
              padding: 12,
              height: 360,
              overflow: 'auto'
            }}
          >
            {messages.length === 0 ? (
              <Text c="dimmed">Say hi 👋</Text>
            ) : (
              <Stack gap="xs">
                {messages.map((m, i) => (
                  <div key={i}>
                    <Text size="sm" fw={600}>
                      {m.sender?.username ||
                        (m.senderId === currentUser?.id ? 'You' : partnerLabel)}
                    </Text>
                    <Text size="sm">{m.content}</Text>
                  </div>
                ))}
              </Stack>
            )}
          </div>

          <Group align="flex-end">
            <TextInput
              placeholder="Type a message"
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button onClick={sendMessage} disabled={!draft.trim()}>
              Send
            </Button>
          </Group>

          {status && <Text c="dimmed">{status}</Text>}
        </Stack>
      )}
    </Paper>
  );
}
