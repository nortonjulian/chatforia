import { useState, useMemo, useEffect } from 'react';
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
import { useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Plus, Users, Settings, PhoneForwarded, Dice5, RefreshCw, MessageSquarePlus } from 'lucide-react';

import StartChatModal from './StartChatModal';
import ChatroomsSidebar from './ChatroomsSidebar';
import UserProfile from './UserProfile';
import axiosClient from '@/api/axiosClient';

function Sidebar({ currentUser, setSelectedRoom, features }) {
  const [showStartModal, setShowStartModal] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

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

  // open StartChatModal via global event
  useEffect(() => {
    const onOpen = () => setShowStartModal(true);
    window.addEventListener('open-new-chat-modal', onOpen);
    return () => window.removeEventListener('open-new-chat-modal', onOpen);
  }, []);

  /* ---------------- SMS Threads (left-rail "Texts") ---------------- */
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  async function loadThreads() {
    if (!currentUser) return;
    try {
      setThreadsLoading(true);
      const res = await axiosClient.get('/sms/threads', { params: { limit: 50 } });
      const items = Array.isArray(res?.data?.items)
        ? res.data.items
        : Array.isArray(res?.data)
        ? res.data
        : [];
      setThreads(items);
    } catch (e) {
      // keep sidebar quiet; log for dev
      console.error('Failed to load SMS threads', e);
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }

  useEffect(() => {
    loadThreads();
  }, [currentUser?.id, location.pathname]);

  // active thread id from URL (/sms/threads/:id)
  const activeSmsId = (() => {
    const m = location.pathname.match(/\/sms\/threads\/(\d+)/);
    return m ? Number(m[1]) : null;
  })();

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
            leftSection={<Dice5 size={16} />}
            component={Link}
            to="/random"
            aria-label="Open Random Chat"
          >
            Random Chat
          </Button>
        )}

        {features?.status && <NavLink to="/status">Status</NavLink>}

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
          {/* In-app chatrooms/DMs */}
          <ChatroomsSidebar
            onStartNewChat={() => setShowStartModal(true)}
            onSelect={setSelectedRoom}
          />

          {/* Texts (SMS/MMS) */}
          {currentUser && (
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Text size="sm" fw={600}>Texts</Text>
                <ActionIcon
                  variant="subtle"
                  title="Refresh texts"
                  aria-label="Refresh texts"
                  onClick={loadThreads}
                  loading={threadsLoading}
                >
                  <RefreshCw size={16} />
                </ActionIcon>
              </Group>

              <Button
                variant="subtle"
                size="xs"
                leftSection={<MessageSquarePlus size={16} />}
                onClick={() => navigate('/sms/compose')}
              >
                New text
              </Button>

              <Stack gap={4}>
                {threads.length === 0 && !threadsLoading ? (
                  <Text c="dimmed" size="xs">No texts yet.</Text>
                ) : (
                  threads.map((t) => {
                    const title = t.contactPhone || t.toNumber || 'Unknown';
                    const preview =
                      t.lastMessageSnippet ||
                      t.lastMessage?.body ||
                      '';
                    const isActive = Number(t.id) === activeSmsId;

                    return (
                      <Button
                        key={t.id}
                        variant={isActive ? 'light' : 'subtle'}
                        size="xs"
                        onClick={() => navigate(`/sms/threads/${t.id}`)}
                        styles={{ root: { justifyContent: 'flex-start' } }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span style={{ lineHeight: 1.2 }}>{title}</span>
                          {preview ? (
                            <span style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {preview}
                            </span>
                          ) : null}
                        </div>
                      </Button>
                    );
                  })
                )}
              </Stack>
            </Stack>
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
