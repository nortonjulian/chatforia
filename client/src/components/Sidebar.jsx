import { useState, useMemo, useEffect, useCallback } from 'react';
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
  MessageSquare, // messages/home icon
  Phone,         // Calls entry point
  Video,         // Video hub (DirectVideo + Rooms)
  Voicemail,     // NEW: Voicemail entry
} from 'lucide-react';

import StartChatModal from '@/components/StartChatModal';
import ChatroomsSidebar from '@/components/ChatroomsSidebar';
import UserProfile from '@/components/UserProfile';
import { useTranslation } from 'react-i18next';

// Ads
import AdSlot from '@/ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';

function Sidebar({ currentUser, setSelectedRoom, features = {} }) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [initialDraft, setInitialDraft] = useState(null); // carries { text, files }
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);

  const navigate = useNavigate();
  const { t } = useTranslation();

  const isPremium = useMemo(
    () => String(currentUser?.plan || 'FREE').toUpperCase() === 'PREMIUM',
    [currentUser?.plan]
  );

  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const handleStartChat = () => {
    if (!currentUser) return;
    setInitialDraft(null);
    setShowStartModal(true);
  };

  // Allow external code to open the StartChatModal by dispatching window event
  useEffect(() => {
    const onOpen = (ev) => {
      // Accept optional draft payload: { text?: string, files?: File[] }
      const draft = ev?.detail?.draft || null;
      setInitialDraft(draft);
      setShowStartModal(true);
    };
    window.addEventListener('open-new-chat-modal', onOpen);
    return () => window.removeEventListener('open-new-chat-modal', onOpen);
  }, []);

  // Local chatroom search/filter state
  const [query, setQuery] = useState('');
  const [roomCount, setRoomCount] = useState(0);

  const refreshRoomsRef = useCallback(() => {
    // ChatroomsSidebar listens for this custom event to reload its data
    window.dispatchEvent(new CustomEvent('sidebar:reload-rooms'));
  }, []);

  return (
    <Box p="md" h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top icons row */}
      <Group justify="space-between" mb="sm">
        {/* Messages/Home */}
        <ActionIcon
          variant="subtle"
          aria-label={t('sidebar.messages', 'Messages')}
          onClick={() => navigate('/chat')}
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
        {/* Random Chat: only when logged in */}
        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Dice5 size={16} />}
            component={Link}
            to="/random"
            aria-label={t('sidebar.randomChat', 'Open Random Chat')}
          >
            {t('sidebar.randomChat', 'Random Chat')}
          </Button>
        )}

        {/* Status link: behind feature flag, shown whether logged in or not */}
        {features?.status && (
          <Button
            variant="subtle"
            size="xs"
            component={Link}
            to="/status"
            aria-label={t('sidebar.status', 'Status')}
          >
            {t('sidebar.status', 'Status')}
          </Button>
        )}

        {/* Calls entry point: only when logged in */}
        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Phone size={16} />}
            component={Link}
            to="/dialer" // or "/calls"
            aria-label={t('sidebar.calls', 'Calls')}
          >
            {t('sidebar.calls', 'Calls')}
          </Button>
        )}

        {/* NEW: Voicemail entry point */}
        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Voicemail size={16} />}
            component={Link}
            to="/voicemail"
            aria-label={t('sidebar.voicemail', 'Voicemail')}
          >
            {t('sidebar.voicemail', 'Voicemail')}
          </Button>
        )}

        {/* Video hub entry: Direct video + Rooms */}
        {currentUser && (features?.video ?? true) && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Video size={16} />}
            component={Link}
            to="/video" // page with DirectVideo + Rooms tabs
            aria-label={t('sidebar.video', 'Video')}
          >
            {t('sidebar.video', 'Video')}
          </Button>
        )}

        {/* Forwarding settings: only when logged in */}
        {currentUser && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<PhoneForwarded size={16} />}
            onClick={() => {
              setProfileTarget('forwarding');
              setProfileOpen(true);
            }}
            aria-label={t(
              'sidebar.forwarding',
              'Open call and text forwarding settings'
            )}
          >
            {t('sidebar.forwarding', 'Call & Text Forwarding')}
          </Button>
        )}
      </Stack>

      {/* Desktop-only ad (FREE plan only) */}
      {!isPremium && !isMobile && (
        <AdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />
      )}

      {/* Conversations header + refresh */}
      <Group justify="space-between" mt="md" mb={6}>
        <Text size="sm" fw={700}>
          {t('sidebar.conversations', 'Conversations')}
          {roomCount > 0 ? '' : ''}
        </Text>
        <ActionIcon
          variant="subtle"
          aria-label={t('sidebar.refreshConversations', 'Refresh conversations')}
          onClick={refreshRoomsRef}
          title={t('sidebar.refreshTooltip', 'Refresh')}
        >
          <RefreshCw size={16} />
        </ActionIcon>
      </Group>

      {/* Conversation search box */}
      <TextInput
        placeholder={t('sidebar.searchPlaceholder', 'Search conversations..')}
        leftSection={<SearchIcon size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        mb="sm"
        aria-label={t('sidebar.searchAriaLabel', 'Search conversations')}
      />

      {/* Chatroom list area */}
      <ScrollArea.Autosize style={{ flex: 1 }} mah="calc(100vh - 220px)">
        <Stack gap="md">
          <ChatroomsSidebar
            onStartNewChat={() => {
              setInitialDraft(null);
              setShowStartModal(true);
            }}
            onSelect={setSelectedRoom}
            hideEmpty
            listOnly
            filterQuery={query}
            onCountChange={setRoomCount}
          />
        </Stack>
      </ScrollArea.Autosize>

      {/* Start New Chat modal */}
      {showStartModal && currentUser && (
        <StartChatModal
          currentUserId={currentUser?.id}
          initialDraft={initialDraft}
          onClose={() => {
            setShowStartModal(false);
            setInitialDraft(null);
          }}
        />
      )}

      {/* Settings drawer */}
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
            <UserProfile
              onLanguageChange={() => {}}
              openSection={profileTarget}
            />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Text c="dimmed">
              {t('sidebar.loginPrompt', 'Log in to edit your settings.')}
            </Text>
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
