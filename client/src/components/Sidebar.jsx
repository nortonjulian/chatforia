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
} from 'lucide-react';

import StartChatModal from '@/components/StartChatModal';
import ChatroomsSidebar from '@/components/ChatroomsSidebar';
import UserProfile from '@/components/UserProfile';

// Ads
import AdSlot from '@/ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';

function Sidebar({ currentUser, setSelectedRoom, features = {} }) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);

  const navigate = useNavigate();

  const isPremium = useMemo(
    () => String(currentUser?.plan || 'FREE').toUpperCase() === 'PREMIUM',
    [currentUser?.plan]
  );

  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const handleStartChat = () => {
    if (!currentUser) return;
    setShowStartModal(true);
  };

  // Allow external code to open the StartChatModal by dispatching window event
  useEffect(() => {
    const onOpen = () => setShowStartModal(true);
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
        <ActionIcon
          variant="subtle"
          onClick={handleStartChat}
          aria-label="Start chat"
          disabled={!currentUser}
        >
          <Plus size={22} />
        </ActionIcon>

        <ActionIcon
          variant="subtle"
          aria-label="Users"
          onClick={() => navigate('/people')}
        >
          <Users size={22} />
        </ActionIcon>

        <ActionIcon
          variant="subtle"
          aria-label="Settings"
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
            aria-label="Open Random Chat"
          >
            Random Chat
          </Button>
        )}

        {/* Status link: behind feature flag, shown whether logged in or not */}
        {features?.status && (
          <Button
            variant="subtle"
            size="xs"
            component={Link}
            to="/status"
            aria-label="Status"
          >
            Status
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
            aria-label="Open call and text forwarding settings"
          >
            Call & Text Forwarding
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
          Conversations
          {roomCount > 0 ? '' : ''}
        </Text>
        <ActionIcon
          variant="subtle"
          aria-label="Refresh conversations"
          onClick={refreshRoomsRef}
          title="Refresh"
        >
          <RefreshCw size={16} />
        </ActionIcon>
      </Group>

      {/* Conversation search box */}
      <TextInput
        placeholder="Search conversations.."
        leftSection={<SearchIcon size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        mb="sm"
        aria-label="Search conversations"
      />

      {/* Chatroom list area */}
      <ScrollArea.Autosize style={{ flex: 1 }} mah="calc(100vh - 220px)">
        <Stack gap="md">
          <ChatroomsSidebar
            onStartNewChat={() => setShowStartModal(true)}
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
          onClose={() => setShowStartModal(false)}
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
            <Text c="dimmed">Log in to edit your settings.</Text>
            <Group>
              <Button component={Link} to="/" variant="filled">
                Log in
              </Button>
              <Button component={Link} to="/register" variant="light">
                Create account
              </Button>
            </Group>
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}

export default Sidebar;
