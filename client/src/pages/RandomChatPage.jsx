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
import { io } from 'socket.io-client';

const SOCKET_URL =
  import.meta.env.VITE_API_BASE_URL || window.location.origin;

function buildSocket() {
  const token = localStorage.getItem('token');

  return io(SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true,
    auth: token ? { token } : undefined,
  });
}

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
    content: payload?.content ?? '',
    senderId: payload?.senderId ?? null,
    sender: payload?.sender ?? null,
    createdAt: payload?.createdAt ?? new Date().toISOString(),
  };
}

export default function RandomChatPage() {
  const navigate = useNavigate();
  const socketRef = useRef(null);
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
    ageBand: null,
    wantsAgeFilter: false,
  });
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

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

        const token = localStorage.getItem('token');
        const res = await fetch('/api/auth/me', {
          headers: token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : {},
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error('Failed to load profile');
        }

        const data = await res.json();

        if (cancelled) return;

        setProfile({
          ageBand: data?.user?.ageBand ?? null,
          wantsAgeFilter: !!data?.user?.wantsAgeFilter,
        });
      } catch (err) {
        if (!cancelled) {
          setProfile({
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

  useEffect(() => {
    const socket = buildSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setErrorText('');
    });

    socket.on('connect_error', (err) => {
      setErrorText(err?.message || 'Unable to connect.');
    });

    socket.on('random:waiting', (payload) => {
      setStatus('matching');
      setBannerText(payload?.message || 'Looking for someone to chat with…');
    });

    socket.on('random:matched', (payload) => {
      setStatus('matched');
      setErrorText('');
      setBannerText('');

      setActive({
        roomId: payload.roomId,
        myAlias: payload.myAlias || 'You',
        partnerAlias: payload.partnerAlias || 'Someone',
        isAI: false,
        chatRoomId: null,
        unlockedUsername: null,
        unlockedUserId: null,
        iRequestedFriend: false,
      });

      setMessages([
        systemMessage(`You matched with ${payload.partnerAlias || 'someone new'}. Say hi 👋`),
      ]);
    });

    socket.on('random:ai_started', (payload) => {
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

      setMessages([systemMessage('You are now chatting with Ria.')]);
    });

    socket.on('random:message', (payload) => {
      setMessages((prev) => [...prev, normalizeIncomingMessage(payload)]);
    });

    socket.on('random:friend_accepted', (payload) => {
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
            : 'You’re now connected.'
        ),
      ]);

      if (payload?.chatRoomId) {
        window.setTimeout(() => {
          navigate(`/chat/${payload.chatRoomId}`);
        }, 700);
      }
    });

    socket.on('random:ended', (payload) => {
      setStatus('ended');

      const reason = payload?.reason;
      let text = 'This chat ended.';

      if (reason === 'peer_skipped') {
        text = 'The other person moved on.';
      } else if (reason === 'peer_disconnected') {
        text = 'The other person disconnected.';
      } else if (reason === 'you_skipped') {
        text = 'You left the chat.';
      }

      setBannerText(text);
      setMessages((prev) => [...prev, systemMessage(text)]);
      setActive(null);
      setDraft('');
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [navigate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const startMatching = () => {
    const socket = socketRef.current;
    if (!socket) return;

    if (!canStartHumanMatch) {
      setErrorText('');
      setBannerText(
        'Set your age range in Profile → Age & Random Chat to be matched with people.'
      );
      return;
    }

    setErrorText('');
    setBannerText('');
    setStatus('matching');
    setActive(null);
    setMessages([]);
    setDraft('');

    socket.emit('random:join', {});
  };

  const cancelMatching = () => {
    const socket = socketRef.current;
    if (!socket) return;

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

    socket.emit('random:ai_start');
  };

  const sendMessage = () => {
    const socket = socketRef.current;
    if (!socket || !active?.roomId) return;

    const text = draft.trim();
    if (!text) return;

    const optimistic = {
      id: `local-${Date.now()}`,
      kind: 'message',
      content: text,
      senderId: -1,
      sender: { username: active.myAlias || 'You' },
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');

    socket.emit('random:message', {
      roomId: active.roomId,
      content: text,
    });
  };

  const nextPerson = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('random:skip');
  };

  const addFriend = () => {
    const socket = socketRef.current;
    if (!socket || !active?.roomId || active?.isAI) return;

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

    nextPerson();
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
          <Title order={2}>Random Chat</Title>
          <Text c="dimmed">
            Meet someone new instantly, or choose to chat with Ria.
          </Text>
        </Stack>

        {errorText ? (
          <Alert color="red" title="Connection problem">
            {errorText}
          </Alert>
        ) : null}

        {!showChatPane ? (
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Stack gap={2}>
                  <Text fw={600}>Start a conversation</Text>
                  <Text size="sm" c="dimmed">
                    Chat anonymously first. Add Friend later if it feels right.
                  </Text>
                </Stack>

                {status === 'matching' ? (
                  <Badge color="blue" variant="light">
                    Matching…
                  </Badge>
                ) : (
                  <Badge color="gray" variant="light">
                    Idle
                  </Badge>
                )}
              </Group>

              {!isLoadingProfile && !canStartHumanMatch ? (
                <Alert color="yellow" variant="light">
                  Set your age range in Profile → Age & Random Chat to be matched with people.
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
                      Find me a match
                    </Button>

                    <Button
                      variant="light"
                      leftSection={<IconRobot size={16} />}
                      onClick={startRiaChat}
                    >
                      Chat with Ria
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
                      Searching…
                    </Button>

                    <Button
                      color="red"
                      variant="light"
                      leftSection={<IconX size={16} />}
                      onClick={cancelMatching}
                    >
                      Cancel
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
                      AI
                    </Badge>
                  ) : (
                    <Badge variant="light" color="blue">
                      Anonymous
                    </Badge>
                  )}
                </Group>

                {!active?.isAI ? (
                  active?.unlockedUsername ? (
                    <Text size="sm" c="dimmed">
                      Connected as @{active.unlockedUsername}
                    </Text>
                  ) : active?.iRequestedFriend ? (
                    <Text size="sm" c="dimmed">
                      Waiting for them to accept Add Friend…
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Usernames stay hidden until both people choose Add Friend.
                    </Text>
                  )
                ) : (
                  <Text size="sm" c="dimmed">
                    AI chat is separate from random human matching.
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
                    {active?.iRequestedFriend ? 'Requested' : 'Add Friend'}
                  </Button>
                ) : null}

                <Button
                  color={active?.isAI ? 'gray' : 'red'}
                  variant="light"
                  size="xs"
                  leftSection={
                    active?.isAI ? <IconX size={14} /> : <IconRefresh size={14} />
                  }
                  onClick={leaveCurrent}
                >
                  {active?.isAI ? 'Leave' : 'Next Person'}
                </Button>
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

                  const isMine = msg.senderId === -1;
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
                    ? 'Message Ria…'
                    : `Message ${active?.partnerAlias || 'your match'}…`
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
                aria-label="Send message"
              >
                <IconArrowRight size={18} />
              </ActionIcon>
            </Group>
          </Card>
        ) : null}

        {status === 'ended' ? (
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Text fw={600}>Chat ended</Text>
              <Text size="sm" c="dimmed">
                {bannerText || 'That conversation has ended.'}
              </Text>

              <Group>
                <Button
                  onClick={startMatching}
                  disabled={isLoadingProfile || !canStartHumanMatch}
                >
                  Find another match
                </Button>

                <Button
                  variant="light"
                  leftSection={<IconRobot size={16} />}
                  onClick={startRiaChat}
                >
                  Chat with Ria
                </Button>
              </Group>

              {!isLoadingProfile && !canStartHumanMatch ? (
                <Alert color="yellow" variant="light">
                  Set your age range in Profile → Age & Random Chat to be matched with people.
                </Alert>
              ) : null}
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </Box>
  );
}