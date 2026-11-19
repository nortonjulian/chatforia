import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArrowRight,
  IconRobot,
  IconRefresh,
  IconUserPlus,
  IconX,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import posthog from '@/utils/analytics';
import axiosClient from '@/api/axiosClient';
import { useSocket } from '@/context/SocketContext';
import { fetchLatestMessages } from '@/lib/api';
import loadEncryptionClient from '@/utils/loadEncryptionClient';
import { encryptForSingleUser } from '@/utils/encryptionClient';

function systemMessage(text) {
  return {
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'system',
    content: text,
    createdAt: new Date().toISOString(),
  };
}

function normalizeIncomingMessage(payload) {
  return {
    id:
      payload?.id ??
      `${payload?.senderId ?? 'msg'}-${payload?.createdAt ?? Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`,
    kind: 'message',
    content: payload?.decryptedContent ?? payload?.rawContent ?? payload?.content ?? '',
    senderId: payload?.senderId ?? payload?.sender?.id ?? null,
    sender: payload?.sender ?? null,
    clientMessageId: payload?.clientMessageId ?? null,
    chatRoomId: payload?.chatRoomId ?? payload?.roomId ?? null,
    createdAt: payload?.createdAt ?? new Date().toISOString(),
  };
}

function mergeMessage(rows, incoming) {
  const next = rows.filter((row) =>
    !(incoming.id != null && String(row.id) === String(incoming.id)) &&
    !(incoming.clientMessageId && row.clientMessageId === incoming.clientMessageId)
  );
  return [...next, incoming].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
    Number(a.id || 0) - Number(b.id || 0)
  );
}

async function decryptHumanMessages(rows, userId, publicKey) {
  const crypto = await loadEncryptionClient();
  const privateKey = publicKey && crypto.getUnlockedPrivateKeyForPublicKey
    ? await crypto.getUnlockedPrivateKeyForPublicKey(publicKey)
    : await crypto.getUnlockedPrivateKey?.();
  return crypto.decryptFetchedMessages(rows, privateKey, null, userId);
}

export default function RandomChatPage() {
  const navigate = useNavigate();
  const { socket } = useSocket() || {};
  const socketRef = useRef(null);
  const activeRef = useRef(null);
  const profileRef = useRef(null);
  const pendingResumeIdRef = useRef(null);
  const bottomRef = useRef(null);

  const [status, setStatus] = useState('idle');
  // idle | matching | matched | ended | ai

  const [active, setActive] = useState(null);
  // {
  //   roomId,
  //   myAlias,
  //   partnerAlias,
  //   isAI,
  //   chatRoomId,
  //   unlockedUsername,
  //   unlockedUserId,
  //   iRequestedFriend,
  // }

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [bannerText, setBannerText] = useState('');
  const [errorText, setErrorText] = useState('');

  const [profile, setProfile] = useState({
    id: null,
    publicKey: null,
    ageBand: null,
    wantsAgeFilter: false,
  });
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState(false);
  const { t } = useTranslation();
  socketRef.current = socket;
  activeRef.current = active;
  profileRef.current = profile;

  const canSend = useMemo(() => {
    return !!active?.roomId && draft.trim().length > 0;
  }, [active, draft]);

  const canStartHumanMatch = useMemo(() => {
    return !!profile.ageBand;
  }, [profile.ageBand]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        setIsLoadingProfile(true);
        setProfileLoadError(false);

        // Match Profile's authenticated API origin and credentials.
        const { data } = await axiosClient.get('/auth/me');

        if (cancelled) return;

        setProfile({
          id: data?.user?.id ?? null,
          publicKey: data?.user?.publicKey ?? null,
          ageBand: data?.user?.ageBand ?? null,
          wantsAgeFilter: !!data?.user?.wantsAgeFilter,
        });
      } catch (err) {
        if (!cancelled) {
          setProfileLoadError(true);
          setProfile({
            id: null,
            publicKey: null,
            ageBand: null,
            wantsAgeFilter: false,
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProfile(false);
        }
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  async function syncHumanMessages(roomId) {
    const identity = profileRef.current;
    if (!identity?.id || !Number.isSafeInteger(Number(roomId))) return;
    const data = await fetchLatestMessages(roomId, 50);
    const rows = Array.isArray(data?.items) ? data.items : [];
    const decrypted = await decryptHumanMessages(rows, identity.id, identity.publicKey);
    if (Number(activeRef.current?.roomId) !== Number(roomId)) return;
    setMessages((previous) => decrypted.slice().reverse().reduce(
      (next, row) => mergeMessage(next, normalizeIncomingMessage(row)), previous
    ));
  }

  useEffect(() => {
    if (profile.id && active?.chatRoomId && !active.isAI)
      syncHumanMessages(active.chatRoomId).catch(() => {});
  }, [profile.id, profile.publicKey, active?.chatRoomId, active?.isAI]);

  useEffect(() => {
    if (!socket) return undefined;
    const listeners = [];
    const on = (event, handler) => { socket.on(event, handler); listeners.push([event, handler]); };
    const requestResume = () => {
      const requestId = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingResumeIdRef.current = requestId;
      socket.emit('random:resume', { requestId });
    };

    on('connect', () => {
      setErrorText('');
      requestResume();
    });
    if (socket.connected) requestResume();

    on('connect_error', (err) => {
      setErrorText(err?.message || 'Unable to connect.');
    });

    on('random:waiting', (payload) => {
      setStatus('matching');
      setBannerText(payload?.message || 'Looking for someone to chat with…');
    });

    // Handle backend safety rejections explicitly: never leave the UI stuck matching.
    on('random:error', (payload) => {
      const code = String(payload?.code || '');
      const textByCode = {
        AGE_ATTESTATION_REQUIRED: t(
          'randomChat.ageAttestationRequired',
          'Confirm your age range in Profile → Age & Random Chat before finding a match.'
        ),
        ACCOUNT_BLOCKED: t(
          'randomChat.pairingUnavailable',
          'This conversation is unavailable. You can find another match.'
        ),
        NOT_IN_ACTIVE_SESSION: t(
          'randomChat.sessionExpired',
          'This chat session is no longer active. Start a new conversation.'
        ),
        MATCHMAKING_UNAVAILABLE: t(
          'randomChat.matchmakingUnavailable',
          'Matchmaking is temporarily unavailable. Please try again.'
        ),
        MESSAGING_UNAVAILABLE: t(
          'randomChat.messagingUnavailable',
          'Messaging is temporarily unavailable. Please try again.'
        ),
      };
      setErrorText(
        textByCode[code] || t('randomChat.unavailable', 'Random Chat is temporarily unavailable.')
      );
      setBannerText('');
      if (code === 'AGE_ATTESTATION_REQUIRED') {
        // The server is authoritative even if a stale profile has an age band.
        setProfile((previous) => ({ ...previous, ageBand: null }));
      }
      if (code === 'ACCOUNT_BLOCKED' || code === 'NOT_IN_ACTIVE_SESSION') {
        setActive(null);
        setMessages([]);
        setDraft('');
        setStatus('idle');
      } else {
        setStatus((previous) => previous === 'matching' ? 'idle' : previous);
      }
    });

    const activateHumanRoom = (payload, resumed = false) => {
      if (resumed && (!pendingResumeIdRef.current ||
          payload?.requestId !== pendingResumeIdRef.current)) return;
      pendingResumeIdRef.current = null;
      const next = {
        roomId: payload.roomId,
        myAlias: payload.myAlias || 'You',
        partnerAlias: payload.partnerAlias || 'Someone',
        isAI: false,
        chatRoomId: payload.chatRoomId ?? payload.roomId,
        iRequestedFriend: !!payload.iRequestedFriend,
      };
      activeRef.current = next;
      setStatus('matched');
      setErrorText('');
      setBannerText(payload.partnerReconnecting ? 'Your match is reconnecting…' : '');
      setActive(next);
      socket.emit('join:rooms', [String(next.chatRoomId)]);
      if (!resumed) {
        posthog.capture('random_chat_matched', { roomId: payload?.roomId });
        setMessages([systemMessage(`You matched with ${next.partnerAlias}. Say hi 👋`)]);
      }
      syncHumanMessages(next.chatRoomId).catch(() => {
        setErrorText('Could not load encrypted messages. Please unlock your encryption key and retry.');
      });
    };

    on('random:matched', (payload) => {
      activateHumanRoom(payload);
    });
    on('random:resumed', (payload) => activateHumanRoom(payload, true));
    on('random:none', (payload) => {
      if (!pendingResumeIdRef.current ||
          payload?.requestId !== pendingResumeIdRef.current) return;
      pendingResumeIdRef.current = null;
      if (!activeRef.current || activeRef.current.isAI) return;
      activeRef.current = null;
      setActive(null);
      setMessages([]);
      setDraft('');
      setStatus('ended');
      setBannerText('This chat session expired. Find another match.');
    });
    on('random:peer_reconnecting', (payload) => {
      if (Number(payload?.roomId) === Number(activeRef.current?.roomId))
        setBannerText('Your match is reconnecting…');
    });
    on('random:peer_resumed', (payload) => {
      if (Number(payload?.roomId) === Number(activeRef.current?.roomId)) setBannerText('');
    });
    on('message:upsert', async (payload) => {
      const row = payload?.item ?? payload?.message ?? payload;
      const roomId = Number(row?.chatRoomId ?? payload?.roomId);
      if (!activeRef.current || activeRef.current.isAI ||
          roomId !== Number(activeRef.current.chatRoomId)) return;
      try {
        const decrypted = await decryptHumanMessages([row], profileRef.current?.id,
          profileRef.current?.publicKey);
        if (Number(activeRef.current?.chatRoomId) === roomId && decrypted[0])
          setMessages((previous) => mergeMessage(previous, normalizeIncomingMessage(decrypted[0])));
      } catch {
        syncHumanMessages(roomId).catch(() => {});
      }
    });

    on('random:ai_started', (payload) => {
      setStatus('ai');
      setErrorText('');
      setBannerText('');

      setActive({
        roomId: payload.roomId,
        myAlias: 'You',
        partnerAlias: payload.name || 'Ria',
        isAI: true,
        chatRoomId: null,
        unlockedUsername: 'Ria',
        unlockedUserId: 0,
        iRequestedFriend: false,
      });

      posthog.capture('ria_chat_started', {
        source: 'random_chat',
        roomId: payload?.roomId,
      });

      setMessages([systemMessage("YOU'RE NOW CHATTING WITH RIA.")]);
    });

    on('random:message', (payload) => {
      if (activeRef.current?.isAI &&
          (payload?.roomId ?? payload?.randomChatRoomId) === activeRef.current.roomId)
        setMessages((prev) => mergeMessage(prev, normalizeIncomingMessage(payload)));
    });

    on('random:friend_accepted', (payload) => {
      setActive((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chatRoomId: payload.chatRoomId ?? null,
          unlockedUsername: payload.username ?? null,
          unlockedUserId: payload.userId ?? null,
        };
      });

      setMessages((prev) => [
        ...prev,
        systemMessage(
          payload?.username
            ? `You’re now connected with @${payload.username}.`
            : t('randomChat.connected', 'You’re now connected.')
        ),
      ]);

      if (payload?.chatRoomId) {
        window.setTimeout(() => {
          navigate(`/chat/${payload.chatRoomId}`);
        }, 700);
      }
    });

    on('random:ended', (payload) => {
      if (String(payload?.roomId) !== String(activeRef.current?.roomId)) return;
      pendingResumeIdRef.current = null;
      setStatus('ended');

      const reason = payload?.reason;

      posthog.capture('random_chat_ended', {
        reason: reason || 'unknown',
      });

      let text = 'This chat ended.';

      if (reason === 'peer_skipped') {
        text = 'The other person moved on.';
      } else if (reason === 'peer_disconnected') {
        text = t('randomChat.disconnected', 'The other person disconnected.')
      } else if (reason === 'you_skipped') {
        text = t('randomChat.left', 'You left the chat.')
      }

      setBannerText(text);
      setMessages([]);
      setActive(null);
      setDraft('');
    });

    return () => {
      listeners.forEach(([event, handler]) => socket.off(event, handler));
    };
  }, [socket, navigate, t]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const startMatching = () => {
    const socket = socketRef.current;
    if (!socket) return;

    if (!canStartHumanMatch) {
      setErrorText(profileLoadError
        ? t('randomChat.profileUnavailable', 'Could not verify your age range. Please try again.')
        : '');
      setBannerText(
        t('randomChat.setAge', 'Set your age range in Profile → Age & Random Chat to be matched with people.')
      );
      return;
    }

    setErrorText('');
    setBannerText('');
    setStatus('matching');
    setActive(null);
    setMessages([]);
    setDraft('');

    posthog.capture('random_chat_match_started');

    const requestId = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    pendingResumeIdRef.current = requestId;
    socket.emit('random:join', { requestId });
  };

  const cancelMatching = () => {
    const socket = socketRef.current;
    if (!socket) return;


    posthog.capture('random_chat_match_cancelled');

    socket.emit('random:leave');
    setStatus('idle');
    setBannerText('');
    setActive(null);
    setMessages([]);
    setDraft('');
  };

  const startRiaChat = () => {
    const socket = socketRef.current;
    if (!socket) return;

    setErrorText('');
    setBannerText('');
    setStatus('matching');
    setActive(null);
    setMessages([]);
    setDraft('');

    posthog.capture('ria_chat_requested', {
      source: 'random_chat',
    });

    socket.emit('random:ai_start');
  };

  const sendMessage = async () => {
    const socket = socketRef.current;
    if (!socket || !active?.roomId) return;

    const text = draft.trim();
    if (!text) return;

    const clientMessageId = `web-random-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      id: clientMessageId,
      kind: 'message',
      content: text,
      senderId: active.isAI ? -1 : profile.id,
      sender: { username: active.myAlias || 'You' },
      clientMessageId,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');

    posthog.capture(active?.isAI ? 'ria_message_sent' : 'random_chat_message_sent', {
      source: 'random_chat',
      roomId: active.roomId,
    });

    if (active.isAI) {
      socket.emit('random:message', { roomId: active.roomId, content: text });
      return;
    }
    try {
      const roomId = Number(active.chatRoomId);
      const { data } = await axiosClient.get(`/chatrooms/${roomId}/participants`);
      const participants = data?.participants || [];
      if (participants.length !== 2) throw new Error('Match participants unavailable');
      const encryptedPayloads = {};
      for (const participant of participants) {
        const user = participant.user ?? participant;
        if (!user.id || !user.publicKey) throw new Error('Encryption key unavailable');
        encryptedPayloads[String(user.id)] = await encryptForSingleUser(
          text, Number(user.id), user.publicKey, user.preferredLanguage || null
        );
      }
      const saved = await axiosClient.post('/messages', {
        chatRoomId: roomId,
        content: null,
        contentCiphertext: null,
        encryptedPayloads,
        clientMessageId,
      });
      const row = saved?.data?.message;
      if (row) setMessages((previous) => mergeMessage(previous,
        normalizeIncomingMessage({ ...row, clientMessageId, decryptedContent: text })));
    } catch (error) {
      setMessages((previous) => previous.filter((row) => row.clientMessageId !== clientMessageId));
      setDraft(text);
      setErrorText(error?.response?.data?.message || 'Message could not be sent. Please try again.');
    }
  };

  const nextPerson = () => {
    const socket = socketRef.current;
    if (!socket) return;

    posthog.capture('random_chat_next_person', {
      roomId: active?.roomId,
    });

    socket.emit('random:skip');
  };

  const addFriend = () => {
    const socket = socketRef.current;
    if (!socket || !active?.roomId || active?.isAI) return;

    posthog.capture('random_chat_add_friend_requested', {
      roomId: active.roomId,
    });

    socket.emit('random:add_friend', {
      roomId: active.roomId,
    });

    setActive((prev) =>
      prev
        ? {
            ...prev,
            iRequestedFriend: true,
          }
        : prev
    );

    setMessages((prev) => [
      ...prev,
      systemMessage(
        'Friend request sent. If they also choose Add Friend, you’ll be connected.'
      ),
    ]);
  };

  const leaveCurrent = () => {
    const socket = socketRef.current;
    if (!socket) return;

    if (status === 'matching') {
      cancelMatching();
      return;
    }

    if (active?.isAI) {
      setStatus('idle');
      setActive(null);
      setMessages([]);
      setDraft('');
      setBannerText('');
      return;
    }

    socket.emit('random:leave');
    setStatus('idle');
    setActive(null);
    setMessages([]);
    setDraft('');
    setBannerText('');
  };

  const headerTitle = useMemo(() => {
    if (active?.isAI) return active.partnerAlias || 'Ria';
    if (active?.partnerAlias) return active.partnerAlias;
    return 'Random Chat';
  }, [active]);

  const showChatPane = status === 'matched' || status === 'ai';

  return (
    <Box maw={900} mx="auto" px="md" py="lg">
      <Stack gap="lg">
        <Stack gap={6}>
          <Title order={2}>
            {t('randomChat.title', 'Random Chat')}
          </Title>
          <Text c="dimmed">
            {t('randomChat.subtitle', 'Meet someone new instantly, or choose to chat with Ria.')}
          </Text>
        </Stack>

        {errorText ? (
          <Alert color="red" title={t('randomChat.connectionProblem', 'Connection problem')}>
            {errorText}
          </Alert>
        ) : null}

        {!showChatPane ? (
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Stack gap={2}>
                  <Text fw={600}>{status === 'ended' ? t('randomChat.chatEnded', 'Chat ended') : t('randomChat.start', 'Start a conversation')}</Text>
                  {status !== 'ended' ? <Text size="sm" c="dimmed">
                    {t('randomChat.description', 'Chat anonymously first. Add Friend later if it feels right.')}
                  </Text> : null}
                </Stack>

                {status === 'matching' ? (
                  <Badge color="blue" variant="light">
                    {t('randomChat.matching', 'Matching…')}
                  </Badge>
                ) : (
                  <Badge color="gray" variant="light">
                    {status === 'ended' ? t('randomChat.disconnected', 'Disconnected') : t('randomChat.idle', 'Idle')}
                  </Badge>
                )}
              </Group>

              {!isLoadingProfile && profileLoadError ? (
                <Alert color="red" variant="light">
                  {t('randomChat.profileUnavailable', 'Could not verify your age range. Please try again.')}
                </Alert>
              ) : !isLoadingProfile && !canStartHumanMatch ? (
                <Alert color="yellow" variant="light">
                  {t('randomChat.setAge', 'Set your age range in Profile → Age & Random Chat to be matched with people.')}
                </Alert>
              ) : null}

              {bannerText ? (
                <Alert color="blue" variant="light">
                  {bannerText}
                </Alert>
              ) : null}

              <Group>
                {status !== 'matching' ? (
                  <>
                    <Button
                      onClick={startMatching}
                      disabled={isLoadingProfile || !canStartHumanMatch}
                    >
                      {t('randomChat.findMatch', 'Find me a match')}
                    </Button>

                    <Button
                      variant="light"
                      leftSection={<IconRobot size={16} />}
                      onClick={startRiaChat}
                    >
                      {t('randomChat.chatWithRia', 'Chat with Ria')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="light"
                      color="gray"
                      leftSection={<Loader size={16} />}
                      disabled
                    >
                      {t('randomChat.searching', 'Searching…')}
                    </Button>

                    <Button
                      color="red"
                      variant="light"
                      leftSection={<IconX size={16} />}
                      onClick={cancelMatching}
                    >
                      {t('randomChat.cancel', 'Cancel')}
                    </Button>
                  </>
                )}
              </Group>
            </Stack>
          </Card>
        ) : null}

        {showChatPane ? (
          <Card withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
            <Group
              justify="space-between"
              align="center"
              px="md"
              py="sm"
              style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
            >
              <Stack gap={2}>
                <Group gap="xs">
                  <Text fw={700}>{headerTitle}</Text>
                  {active?.isAI ? (
                    <Badge variant="light" color="violet">
                      {t('randomChat.ai', 'AI')}
                    </Badge>
                  ) : (
                    <Badge variant="light" color="blue">
                      {t('randomChat.anonymous', 'Anonymous')}
                    </Badge>
                  )}
                </Group>

                {!active?.isAI ? (
                  active?.unlockedUsername ? (
                    <Text size="sm" c="dimmed">
                      {t('randomChat.connectedAs', 'Connected as')} @{active.unlockedUsername}
                    </Text>
                  ) : active?.iRequestedFriend ? (
                    <Text size="sm" c="dimmed">
                      {t('randomChat.waitingAddFriend', 'Waiting for them to accept Add Friend…')}
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      {t('randomChat.hiddenUsernames', 'Usernames stay hidden until both people choose Add Friend.')}
                    </Text>
                  )
                ) : (
                  <Text size="sm" c="dimmed">
                    {t('randomChat.riaSeparate', 'Chat with Ria anytime — separate from random human matching.')}
                  </Text>
                )}
              </Stack>

              <Group gap="xs">
                {!active?.isAI ? (
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconUserPlus size={14} />}
                    onClick={addFriend}
                    disabled={!!active?.iRequestedFriend}
                  >
                    {active?.iRequestedFriend
                      ? t('randomChat.requested', 'Requested')
                      : t('randomChat.addFriend', 'Add Friend')}
                  </Button>
                ) : null}

                <Button
                  color="gray"
                  variant="light"
                  size="xs"
                  leftSection={<IconX size={14} />}
                  onClick={leaveCurrent}
                >
                  {t('randomChat.leave', 'Leave')}
                </Button>

                {!active?.isAI ? (
                  <Button
                    color="orange"
                    variant="filled"
                    size="xs"
                    leftSection={<IconRefresh size={14} />}
                    onClick={nextPerson}
                  >
                    {t('randomChat.next', 'Next Person')}
                  </Button>
                ) : null}
              </Group>
            </Group>

            <ScrollArea h={420} px="md" py="md">
              <Stack gap="sm">
                {messages.map((msg) => {
                  if (msg.kind === 'system') {
                    return (
                      <Group key={msg.id} justify="center">
                        <Badge variant="light" color="gray">
                          {msg.content}
                        </Badge>
                      </Group>
                    );
                  }

                  const isMine = msg.senderId === -1 || Number(msg.senderId) === Number(profile.id);
                  const senderName = isMine
                    ? active?.myAlias || 'You'
                    : active?.isAI
                    ? 'Ria'
                    : active?.unlockedUsername ||
                      active?.partnerAlias ||
                      msg.sender?.username ||
                      'Someone';

                  return (
                    <Group key={msg.id} justify={isMine ? 'flex-end' : 'flex-start'}>
                      <Card
                        shadow="sm"
                        radius="md"
                        p="sm"
                        withBorder
                        maw="78%"
                        bg={isMine ? 'blue.0' : 'gray.0'}
                      >
                        <Stack gap={4}>
                          <Text size="xs" c="dimmed">
                            {senderName}
                          </Text>
                          <Text>{msg.content}</Text>
                        </Stack>
                      </Card>
                    </Group>
                  );
                })}
                <div ref={bottomRef} />
              </Stack>
            </ScrollArea>

            <Group
              px="md"
              py="sm"
              style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}
              align="center"
            >
              <TextInput
                placeholder={
                  active?.isAI
                    ? t('randomChat.messageRia', 'Message Ria…')
                    : t('randomChat.messageMatch', 'Message your match…')
                }
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                style={{ flex: 1 }}
              />

              <ActionIcon
                size="lg"
                variant="filled"
                onClick={sendMessage}
                disabled={!canSend}
                aria-label={t('randomChat.sendMessage', 'Send message')}
              >
                <IconArrowRight size={18} />
              </ActionIcon>
            </Group>
          </Card>
        ) : null}

      </Stack>
    </Box>
  );
}
