import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  lazy,
  Suspense,
} from 'react';
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
  PhoneCall,
  Video,
  Voicemail,
  LifeBuoy,
} from 'lucide-react';

const ChatroomsSidebar = lazy(() =>
  import('@/components/ChatroomsSidebar')
);
import StartChatModal from '@/components/StartChatModal';
import UserProfile from '@/components/UserProfile';
import { useTranslation } from 'react-i18next';

// Ads
import AdSlot from '@/ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';

function Sidebar({ currentUser, features = {} }) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [initialDraft, setInitialDraft] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(0);

  // ✅ Critical for tests (no async delay)
  const [showChats, setShowChats] = useState(
    () => process.env.NODE_ENV === 'test'
  );

  const navigate = useNavigate();
  const { t } = useTranslation();

  const isPremium = useMemo(
    () => String(currentUser?.plan || 'FREE').toUpperCase() === 'PREMIUM',
    [currentUser?.plan]
  );

  const theme = useMantineTheme();
  const isMobile = useMediaQuery(
    `(max-width: ${theme.breakpoints.sm})`
  );

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
    return () =>
      window.removeEventListener('open-new-chat-modal', onOpen);
  }, []);

  // ✅ Skip delay in tests
  useEffect(() => {
    if (showChats) return;
    const timer = setTimeout(() => setShowChats(true), 100);
    return () => clearTimeout(timer);
  }, [showChats]);

  const refreshChats = useCallback(() => {
    window.dispatchEvent(new CustomEvent('sidebar:reload-rooms'));
  }, []);

  const onSelectChat = useCallback(
    (thread) => {
      if (!thread) return;

      if (thread.kind === 'sms' || thread.type === 'sms') {
        navigate(`/sms/${thread.id}`);
        return;
      }

      const roomId =
        thread.chatRoomId ??
        thread.roomId ??
        thread.chatroomId ??
        thread.id;

      if (!Number.isFinite(Number(roomId))) return;

      navigate(`/chat/${Number(roomId)}`);
    },
    [navigate]
  );

  return (
    <Box p="md" h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top icons */}
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

      {/* Quick links */}
      <Stack gap="xs" mb="sm">
        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            aria-label="Open Random Chat"
            leftSection={<Dice5 size={16} />}
            component={Link}
            to="/random"
          >
            {t('sidebar.randomChat', 'Random Chat')}
          </Button>
        )}

        {features?.status && (
          <Button variant="subtle" size="xs" component={Link} to="/status">
            Status
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
            leftSection={<PhoneCall size={16} />}
            component={Link}
            to="/calls/history"
          >
            {t('sidebar.callHistory', 'Call History')}
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
            aria-label="Open call and text forwarding settings"
            leftSection={<PhoneForwarded size={16} />}
            onClick={() => {
              setProfileTarget('forwarding');
              setProfileOpen(true);
            }}
          >
            {t('sidebar.forwarding', 'Call & Text Forwarding')}
          </Button>
        )}

        {currentUser?.role === 'ADMIN' && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<LifeBuoy size={16} />}
            component={Link}
            to="/admin/support"
          >
            Support Dashboard
          </Button>
        )}
      </Stack>

      {/* Chats header */}
      <Group justify="space-between" mt="md" mb={6}>
        <Text size="sm" fw={700}>
          {t('sidebar.chats', 'Chats')}
        </Text>
        <ActionIcon
          variant="subtle"
          aria-label={t('sidebar.refreshChats', 'Refresh chats')}
          onClick={refreshChats}
          title={t('sidebar.refreshTooltip', 'Refresh')}
        >
          <RefreshCw size={16} />
        </ActionIcon>
      </Group>

      {/* Search */}
      <TextInput
        placeholder={t('sidebar.searchPlaceholder', 'Search chats..')}
        leftSection={<SearchIcon size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        mb="sm"
        aria-label={t('sidebar.searchAriaLabel', 'Search chats')}
      />

      {/* Chat list */}
      <ScrollArea.Autosize style={{ flex: 1 }} mah="calc(100vh - 220px)">
        <Stack gap="md">
          {showChats ? (
            <Suspense fallback={<Text size="sm" c="dimmed">Loading chats...</Text>}>
              <ChatroomsSidebar
                onStartNewChat={() => {
                  setInitialDraft(null);
                  setShowStartModal(true);
                }}
                onSelect={onSelectChat}
                hideEmpty
                listOnly
                filterQuery={query}
                onCountChange={setCount}
              />
            </Suspense>
          ) : (
            <Text size="sm" c="dimmed">Loading chats...</Text>
          )}
        </Stack>
      </ScrollArea.Autosize>

      {/* Start chat modal */}
      {currentUser && (
        <StartChatModal
          opened={showStartModal}
          currentUserId={currentUser?.id}
          onClose={() => {
            setShowStartModal(false);
            setInitialDraft(null);
          }}
        />
      )}

      {/* Profile drawer */}
      <Drawer
        opened={profileOpen}
        onClose={() => {
          setProfileOpen(false);
          setProfileTarget(null);
        }}
        position="right"
        size="md"
        radius="lg"
      >
        {currentUser ? (
          <Stack gap="xl">
            <UserProfile openSection={profileTarget} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Text c="dimmed">
              {t('sidebar.loginPrompt', 'Log in to edit your settings.')}
            </Text>
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}

export default Sidebar;