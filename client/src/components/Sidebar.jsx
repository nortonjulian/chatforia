import { useState, useMemo } from 'react';
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
} from '@mantine/core';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Plus, Users, Settings, PhoneForwarded, Dice5 } from 'lucide-react';

import StartChatModal from './StartChatModal';
import ChatroomsSidebar from './ChatroomsSidebar';
import UserProfile from './UserProfile';

// Ads
import AdSlot from '../ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';

function Sidebar({ currentUser, setSelectedRoom, features }) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null); // 'forwarding' | null
  const navigate = useNavigate();

  const isPremium = useMemo(
    () => String(currentUser?.plan || 'FREE').toUpperCase() === 'PREMIUM',
    [currentUser?.plan]
  );

  const handleStartChat = () => {
    if (!currentUser) return;
    setShowStartModal(true);
  };

  return (
    <Box p="md" h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top icons */}
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
            setProfileTarget(null); // open drawer at top, no auto-scroll
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
            leftSection={<Dice5 size={16} />}
            component={Link}
            to="/random"
            aria-label="Open Random Chat"
          >
            Random Chat
          </Button>
        )}

        {features?.status && <NavLink to="/status">Status</NavLink>}

        {/* Open user profile drawer and jump to the Forwarding section */}
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

      {/* Main sidebar content */}
      <ScrollArea.Autosize style={{ flex: 1 }} mah="calc(100vh - 200px)">
        <Stack gap="md">
          <ChatroomsSidebar
            onStartNewChat={() => setShowStartModal(true)}
            onSelect={setSelectedRoom}
          />

          {!isPremium && (
            <>
              <Divider my="xs" />
              <AdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />
            </>
          )}
        </Stack>
      </ScrollArea.Autosize>

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
            <UserProfile onLanguageChange={() => {}} openSection={profileTarget} />
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
