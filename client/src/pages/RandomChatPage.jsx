import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Paper,
  Title,
  Text,
  Button,
  Group,
  Loader,
  TextInput,
  Stack,
  Badge,
  Card,
} from '@mantine/core';
import {
  IconMessageCircle,
  IconPlayerPlay,
  IconPlayerStop,
  IconRobot,
} from '@tabler/icons-react';
import { useUser } from '@/context/UserContext';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import socket from '@/lib/socket'; // singleton client

export default function RandomChatPage() {
  const { currentUser } = useUser();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(null); // { roomId, partner, partnerId, isAI? }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  // Tracks whether the *next* pair_found is for the AI flow
  const aiRequestedRef = useRef(false);

  const hasAgeBand = !!currentUser?.ageBand;

  /* ---------- Auth gate (only) ---------- */

  if (!currentUser) {
    return (
      <Paper withBorder radius="xl" p="lg" maw={720} mx="auto">
        <Title order={3}>{t('randomChat.title', 'Random Chat')}</Title>
        <Text size="sm" c="dimmed" mt="xs">
          You need to sign in to use Random Chat.
        </Text>
        <Button mt="md" onClick={() => navigate('/login')}>
          {t('auth.login', 'Log In')}
        </Button>
      </Paper>
    );
  }

  /* ---------- Socket listeners ---------- */
  useEffect(() => {
    if (!socket) return;

    const onPairFound = (payload) => {
      const isAI =
        aiRequestedRef.current ||
        payload?.isAI === true ||
        /bot|ai/i.test(String(payload?.partner || ''));

      const normalized = isAI
        ? { ...payload, isAI: true, partner: t('brand.foria', 'Foria') }
        : payload;

      aiRequestedRef.current = false;
      setActive(normalized);
      setSearching(false);
      setStatus('');
      setMessages([]);
    };

    const onReceiveMessage = (msg) => {
      // Ignore messages that are not for the current room (defensive)
      if (active?.roomId && msg.randomChatRoomId && msg.randomChatRoomId !== active.roomId) {
        return;
      }
      setMessages((p) => [...p, msg]);
    };

    const onPartnerDisconnected = (txt) => {
      setStatus(txt || t('randomChat.partnerDisconnected', 'Your partner disconnected.'));
      setActive(null);
      setSearching(false);
    };

    const onChatSkipped = (txt) => {
      setSearching(false);
      setActive(null);
      setMessages([]);
      setStatus(txt || t('randomChat.stopped', 'Stopped.'));
    };

    const onNoPartner = ({ message } = {}) => {
      setSearching(false);
      setStatus(
        message || t('randomChat.noPartner', 'No partner found right now.')
      );
      // user can always hit "Chat with Foria" after this
    };

    socket.on('pair_found', onPairFound);
    socket.on('receive_message', onReceiveMessage);
    socket.on('partner_disconnected', onPartnerDisconnected);
    socket.on('chat_skipped', onChatSkipped);
    socket.on('no_partner', onNoPartner);

    return () => {
      socket.off('pair_found', onPairFound);
      socket.off('receive_message', onReceiveMessage);
      socket.off('partner_disconnected', onPartnerDisconnected);
      socket.off('chat_skipped', onChatSkipped);
      socket.off('no_partner', onNoPartner);
    };
  }, [t, active?.roomId]);

  /* ---------- Actions ---------- */
  const startSearch = () => {
    if (!socket || !currentUser) return;
    if (!currentUser.ageBand) {
      // Soft gate: don’t start search, just explain
      setStatus(
        t(
          'randomChat.ageBandRequired',
          'Set your age range in Profile → Age & Random Chat to be matched with people.'
        )
      );
      return;
    }

    aiRequestedRef.current = false;
    setSearching(true);
    setStatus(t('randomChat.looking', 'Looking for someone…'));
    setActive(null);
    setMessages([]);
    socket.emit('find_random_chat');
  };

  const startAIChat = () => {
    if (!socket) return;
    aiRequestedRef.current = true;
    setSearching(true);
    setStatus(t('randomChat.startingForia', 'Starting a chat with Foria…'));
    setActive(null);
    setMessages([]);
    socket.emit('start_ai_chat');
  };

  const sendMessage = () => {
    if (!socket || !active || !draft.trim()) return;
    socket.emit('send_message', {
      content: draft.trim(),
      randomChatRoomId: active.roomId,
      senderId: currentUser.id, // helps backend/bot identify the user
    });
    setDraft('');
  };

  // ✅ central cancel/reset (used by Close + Cancel + unmount)
  const cancelAll = useCallback(() => {
    setSearching(false);
    setActive(null);
    setMessages([]);
    setStatus(t('randomChat.cancelled', 'Cancelled.'));
    aiRequestedRef.current = false;
    try {
      socket?.emit?.('skip_random_chat');
    } catch {
      // ignore; local UI already reset
    }
  }, [t]);

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
      } catch {
        // ignore
      }
    };
  }, []);

  const partnerLabel = active?.isAI
    ? t('brand.foria', 'Foria')
    : String(active?.partner ?? t('randomChat.partner', 'Partner'));

  // 🚪 Close button: cancel + navigate home
  const closePage = () => {
    cancelAll();
    navigate('/');
  };

  return (
    <Paper withBorder radius="xl" p="lg" maw={720} mx="auto">
      <Group justify="space-between" align="center">
        <Title order={3}>{t('randomChat.title', 'Random Chat')}</Title>

        <Group gap="xs">
          {active ? (
            <Badge color={active.isAI ? 'grape' : 'green'} variant="light">
              {active.isAI
                ? t('randomChat.withForia', 'With Foria')
                : t('randomChat.connected', 'Connected')}
            </Badge>
          ) : searching ? (
            <Badge color="blue" variant="light">
              {t('randomChat.searching', 'Searching…')}
            </Badge>
          ) : (
            <Badge color="gray" variant="light">
              {t('randomChat.idle', 'Idle')}
            </Badge>
          )}

          <Button variant="subtle" color="gray" size="xs" onClick={closePage}>
            {t('randomChat.close', 'Close')}
          </Button>
        </Group>
      </Group>

      {!active && (
        <Stack mt="md">
          <Text c="dimmed">
            {t(
              'randomChat.description',
              'Meet someone new instantly. We’ll match you and open a temporary chat room.'
            )}
          </Text>

          {/* Button row */}
          <Group
            maw={560}
            mx="auto"
            justify="flex-start"
            wrap="wrap"
            gap="md"
          >
            <Button
              onClick={startSearch}
              leftSection={<IconPlayerPlay size={16} />}
              disabled={searching}
            >
              {searching
                ? t('randomChat.finding', 'Finding…')
                : t('randomChat.findMatch', 'Find me a match')}
            </Button>

            <Button
              variant="light"
              color="gray"
              onClick={cancelAll}
              leftSection={<IconPlayerStop size={16} />}
            >
              {t('randomChat.cancel', 'Cancel')}
            </Button>

            <Button
              variant="subtle"
              leftSection={<IconRobot size={16} />}
              onClick={startAIChat}
            >
              {t('randomChat.chatWithForia', 'Chat with Foria')}
            </Button>
          </Group>

          {/* Soft age hint */}
          {!hasAgeBand && (
            <Text size="sm" c="dimmed">
              {t(
                'profile.ageBandHint',
                'We only store an age range (not your exact date of birth). This is used to keep Random Chat pairings reasonable.'
              )}{' '}
              {' '}
              {t(
                'randomChat.ageBandCallout',
                'To match with people (not just ForiaBot), set your age band in Settings → Age & Random Chat.'
              )}
            </Text>
          )}

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
                  {t('randomChat.youAreChattingWith', 'You’re chatting with {{name}}', {
                    name: partnerLabel,
                  })}
                </Text>
                {active.isAI && (
                  <Badge size="xs" variant="light">
                    {t('randomChat.bot', 'BOT')}
                  </Badge>
                )}
              </Group>
              <Button color="red" variant="light" size="xs" onClick={cancelAll}>
                {t('randomChat.leave', 'Leave')}
              </Button>
            </Group>
          </Card>

          <div
            style={{
              border: '1px solid var(--mantine-color-gray-3)',
              borderRadius: 12,
              padding: 12,
              height: 360,
              overflow: 'auto',
            }}
          >
            {messages.length === 0 ? (
              <Text c="dimmed">{t('randomChat.sayHi', 'Say hi 👋')}</Text>
            ) : (
              <Stack gap="xs">
                {messages.map((m, i) => (
                  <div key={i}>
                    <Text size="sm" fw={600}>
                      {m.sender?.username ||
                        (m.senderId === currentUser?.id
                          ? t('randomChat.you', 'You')
                          : partnerLabel)}
                    </Text>
                    <Text size="sm">{m.content}</Text>
                  </div>
                ))}
              </Stack>
            )}
          </div>

          <Group align="flex-end">
            <TextInput
              placeholder={t('randomChat.typeMessage', 'Type a message')}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <Button onClick={sendMessage} disabled={!draft.trim()}>
              {t('randomChat.send', 'Send')}
            </Button>
          </Group>

          {status && <Text c="dimmed">{status}</Text>}
        </Stack>
      )}
    </Paper>
  );
}
