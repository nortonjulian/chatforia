import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  Box,
  Group,
  ActionIcon,
  ScrollArea,
  Divider,
  Stack,
  Drawer,
  Text,
  Button,
  TextInput,
} from '@mantine/core';
import { useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Users,
  Settings,
  PhoneForwarded,
  Dice5,
  RefreshCw,
  Search as SearchIcon,
  MessageSquare,
  Phone,
  Video,
  Voicemail,
} from 'lucide-react';

const ChatroomsSidebar = lazy(() => import('@/components/ChatroomsSidebar'));
import StartChatModal from '@/components/StartChatModal';
import UserProfile from '@/components/UserProfile';
import { useTranslation } from 'react-i18next';

// Ads
import AdSlot from '@/ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';

function Sidebar({ currentUser }) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [initialDraft, setInitialDraft] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(0);
  const [showConversations, setShowConversations] = useState(false);

  const navigate = useNavigate();
  const { t } = useTranslation();

  const isPremium = useMemo(
    () => String(currentUser?.plan || 'FREE').toUpperCase() === 'PREMIUM',
    [currentUser?.plan]
  );

  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const handleStartChat = useCallback(() => {
    setInitialDraft(null);
    setShowStartModal(true);
  }, []);

  useEffect(() => {
    const onOpen = (ev) => {
      const draft = ev?.detail?.draft || null;
      setInitialDraft(draft);
      setShowStartModal(true);
    };
    window.addEventListener('open-new-chat-modal', onOpen);
    return () => window.removeEventListener('open-new-chat-modal', onOpen);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowConversations(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const refreshConversations = useCallback(() => {
    window.dispatchEvent(new CustomEvent('sidebar:reload-rooms'));
  }, []);

  const onSelectConversation = useCallback(
    (thread) => {
      if (!thread) return;

      console.log('[Sidebar] selected thread object:', thread);

      if (thread.kind === 'sms') {
        navigate(`/sms/${thread.id}`);
        return;
      }

      const roomId =
        thread.chatRoomId ??
        thread.roomId ??
        thread.chatroomId ??
        thread.id;

      console.log('[Sidebar] resolved roomId for navigation:', roomId);

      navigate(`/chat/${roomId}`);
    },
    [navigate]
  );

  return (
    <Box p="md" h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      <Group justify="space-between" mb="sm">
        <ActionIcon
          variant="subtle"
          aria-label={t('sidebar.messages', 'Messages')}
          onClick={() => navigate('/')}
        >
          <MessageSquare size={22} />
        </ActionIcon>

        <ActionIcon
          variant="subtle"
          onClick={handleStartChat}
          aria-label={t('sidebar.startChat', 'Start chat')}
          disabled={!currentUser}
        >
          <Plus size={22} />
        </ActionIcon>

        <ActionIcon
          variant="subtle"
          aria-label={t('sidebar.people', 'People')}
          onClick={() => navigate('/people')}
        >
          <Users size={22} />
        </ActionIcon>

        <ActionIcon
          variant="subtle"
          aria-label={t('sidebar.settings', 'Settings')}
          onClick={() => {
            if (!currentUser) return;
            setProfileTarget(null);
            setProfileOpen(true);
          }}
          disabled={!currentUser}
        >
          <Settings size={22} />
        </ActionIcon>
      </Group>

      <Divider mb="sm" />

      <Stack gap="xs" mb="sm">
        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Dice5 size={16} />}
            component={Link}
            to="/random"
          >
            {t('sidebar.randomChat', 'Random Chat')}
          </Button>
        )}

        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Phone size={16} />}
            component={Link}
            to="/dialer"
          >
            {t('sidebar.calls', 'Calls')}
          </Button>
        )}

        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Voicemail size={16} />}
            component={Link}
            to="/voicemail"
          >
            {t('sidebar.voicemail', 'Voicemail')}
          </Button>
        )}

        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Video size={16} />}
            component={Link}
            to="/video"
          >
            {t('sidebar.video', 'Video')}
          </Button>
        )}

        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<PhoneForwarded size={16} />}
            onClick={() => {
              setProfileTarget('forwarding');
              setProfileOpen(true);
            }}
          >
            {t('sidebar.forwarding', 'Call & Text Forwarding')}
          </Button>
        )}
      </Stack>

      {!isPremium && !isMobile && <AdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />}

      <Group justify="space-between" mt="md" mb={6}>
        <Text size="sm" fw={700}>
          {t('sidebar.conversations', 'Conversations')}
        </Text>
        <ActionIcon
          variant="subtle"
          aria-label={t('sidebar.refreshConversations', 'Refresh conversations')}
          onClick={refreshConversations}
          title={t('sidebar.refreshTooltip', 'Refresh')}
        >
          <RefreshCw size={16} />
        </ActionIcon>
      </Group>

      <TextInput
        placeholder={t('sidebar.searchPlaceholder', 'Search conversations..')}
        leftSection={<SearchIcon size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        mb="sm"
        aria-label={t('sidebar.searchAriaLabel', 'Search conversations')}
      />

      <ScrollArea.Autosize style={{ flex: 1 }} mah="calc(100vh - 220px)">
        <Stack gap="md">
          {showConversations ? (
            <Suspense fallback={<Text size="sm" c="dimmed">Loading conversations...</Text>}>
              <ChatroomsSidebar
                onStartNewChat={() => {
                  setInitialDraft(null);
                  setShowStartModal(true);
                }}
                onSelect={onSelectConversation}
                hideEmpty
                listOnly={false}
                filterQuery={query}
                onCountChange={setCount}
              />
            </Suspense>
          ) : (
            <Text size="sm" c="dimmed">Loading conversations...</Text>
          )}
        </Stack>
      </ScrollArea.Autosize>

      {currentUser && (
        <StartChatModal
          opened={showStartModal}
          onClose={() => {
            setShowStartModal(false);
            setInitialDraft(null);
          }}
          initialDraft={initialDraft}
          onStartDirectMessage={(payload) => {
            setShowStartModal(false);
            navigate('/');

            setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent('prefill-home-to', {
                  detail: payload,
                })
              );
            }, 0);
          }}
          onStartGroupChat={() => {
            setShowStartModal(false);
            navigate('/groups/new');
          }}
          onStartRandomChat={() => {
            setShowStartModal(false);
            navigate('/random-chat');
          }}
          onStartRiaChat={() => {
            setShowStartModal(false);
            navigate('/ria');
          }}
        />
      )}

      <Drawer
        opened={profileOpen}
        onClose={() => {
          setProfileOpen(false);
          setProfileTarget(null);
        }}
        position="right"
        size="md"
        radius="lg"
        overlayProps={{ opacity: 0.15, blur: 2 }}
      >
        {currentUser ? (
          <Stack gap="xl">
            <UserProfile onLanguageChange={() => {}} openSection={profileTarget} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Text c="dimmed">{t('sidebar.loginPrompt', 'Log in to edit your settings.')}</Text>
            <Group>
              <Button component={Link} to="/" variant="filled">
                {t('auth.login', 'Log in')}
              </Button>
              <Button component={Link} to="/register" variant="light">
                {t('auth.signup', 'Create account')}
              </Button>
            </Group>
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}

export default Sidebar;