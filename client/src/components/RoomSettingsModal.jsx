import { useEffect, useState } from 'react';
import {
  Modal,
  Stack,
  Select,
  Switch,
  Group,
  Button,
  Divider,
  Table,
  Avatar,
  Text,
  Badge,
  Loader,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useUser } from '../context/UserContext';
import axiosClient from '../api/axiosClient';
import { useTranslation } from 'react-i18next';
import './RoomSettingsModal.css';

export default function RoomSettingsModal({
  opened,
  onClose,
  room,
  onUpdated,
  // Launch-safe default: expose only verified participant management.
  // These room-specific controls must remain hidden until their actual
  // AI/E2EE and translation message behavior is validated end-to-end.
  showExperimentalRoomControls = false,
}) {
  const { currentUser } = useUser();
  const { t } = useTranslation();

  // Participants state
  const [ownerId, setOwnerId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const myUserId = String(currentUser?.id ?? '');
  const effectiveOwnerId = String(ownerId ?? room?.ownerId ?? '');
  const isOwner = Boolean(myUserId && effectiveOwnerId && myUserId === effectiveOwnerId);
  const isRoomAdmin = participants.some(
    (p) => String(p.userId ?? p.user?.id) === myUserId && p.role === 'ADMIN'
  );
  const canEdit = currentUser?.role === 'ADMIN' || isOwner || isRoomAdmin;
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [removingUserId, setRemovingUserId] = useState(null);

  // Room-level settings
  const [aiMode, setAiMode] = useState(String(room?.aiAssistantMode || 'OFF').toUpperCase());
  const [savingAIMode, setSavingAIMode] = useState(false);

  const [autoTranslateMode, setAutoTranslateMode] = useState(
    String(room?.autoTranslateMode || 'OFF').toUpperCase()
  );
  const [savingAutoTranslate, setSavingAutoTranslate] = useState(false);

  // Per-user (in this room) preference
  const [allowAIBot, setAllowAIBot] = useState(room?.me?.allowAIBot ?? true);
  const [savingAllow, setSavingAllow] = useState(false);
  const [roomBotEnabled, setRoomBotEnabled] = useState(Boolean(room?.allowForiaBot));
  const [savingRoomBot, setSavingRoomBot] = useState(false);

  const ROLE_OPTS = [
  { value: 'MEMBER', label: t('roomSettings.roles.member', 'Member') },
  { value: 'MODERATOR', label: t('roomSettings.roles.moderator', 'Moderator') },
  { value: 'ADMIN', label: t('roomSettings.roles.admin', 'Admin') },
 ];

  const AI_MODE_OPTS = [
  { value: 'OFF', label: t('roomSettings.aiMode.off', 'Off') },
  { value: 'MENTION', label: t('roomSettings.aiMode.mention', 'Only on @ForiaBot or /ask') },
  { value: 'ALWAYS', label: t('roomSettings.aiMode.always', 'Reply proactively') },
];

  const AUTO_TRANSLATE_OPTS = [
  { value: 'OFF', label: t('roomSettings.autoTranslateMode.off', 'Off') },
  { value: 'TAGGED', label: t('roomSettings.autoTranslateMode.tagged', 'Tagged only (/tr …)') },
  { value: 'ALL', label: t('roomSettings.autoTranslateMode.all', 'All messages') },
];

  // keep local state in sync when room prop changes
  useEffect(() => {
    setAiMode(String(room?.aiAssistantMode || 'OFF').toUpperCase());
    setAutoTranslateMode(String(room?.autoTranslateMode || 'OFF').toUpperCase());
    setAllowAIBot(room?.me?.allowAIBot ?? true);
    setRoomBotEnabled(Boolean(room?.allowForiaBot));
  }, [
    room?.id,
    room?.aiAssistantMode,
    room?.autoTranslateMode,
    room?.me?.allowAIBot,
    room?.allowForiaBot,
  ]);

  // The parent ChatView owns the room prop but does not pass an onUpdated callback.
  // Refresh canonical values on each opening so previously saved settings reappear.
  useEffect(() => {
    if (!opened || !room?.id) return;
    let active = true;
    axiosClient.get(`/chatrooms/${room.id}`)
      .then(({ data }) => {
        if (!active || !data || String(data.id) !== String(room.id)) return;
        setAiMode(String(data.aiAssistantMode || 'OFF').toUpperCase());
        setAutoTranslateMode(String(data.autoTranslateMode || 'OFF').toUpperCase());
        setRoomBotEnabled(Boolean(data.allowForiaBot));
        if (typeof data.me?.allowAIBot === 'boolean') {
          setAllowAIBot(data.me.allowAIBot);
        }
      })
      .catch(() => {
        // Keep prop-backed settings if the refresh is temporarily unavailable.
      });
    return () => { active = false; };
  }, [opened, room?.id]);

  const loadParticipants = async () => {
    if (!room?.id) return;
    setLoadingParticipants(true);
    try {
      const { data } = await axiosClient.get(
        `/chatrooms/${room.id}/participants`
      );
      setOwnerId(data.ownerId ?? null);
      setParticipants(data.participants || []);
    } catch (e) {
      // noop
    } finally {
      setLoadingParticipants(false);
    }
  };

  useEffect(() => {
    if (opened) loadParticipants();
  }, [opened, room?.id]);

  // Participants actions
  const changeRole = async (userId, role) => {
    try {
      await axiosClient.patch(
        `/chatrooms/${room.id}/participants/${userId}/role`,
        { role }
      );
      await loadParticipants();
      notifications.show({ message: 'Settings updated', withBorder: true });
    } catch (error) {
      notifications.show({
        message: error?.response?.data?.message || error?.response?.data?.error ||
          'Could not change participant role',
        color: 'red',
        withBorder: true,
      });
    }
  };

  const removeUser = async (userId) => {
    if (removingUserId !== null) return;
    setRemovingUserId(userId);
    try {
      await axiosClient.delete(`/chatrooms/${room.id}/participants/${userId}`);
      await loadParticipants();
      notifications.show({ message: 'Participant removed', withBorder: true });
    } catch (error) {
      notifications.show({
        title: 'Could not remove participant',
        message: error?.response?.data?.message || error?.response?.data?.error ||
          error?.message || 'Please try again.',
        color: 'red',
        withBorder: true,
      });
    } finally {
      setRemovingUserId(null);
    }
  };

  // Room settings actions
  const saveAIMode = async () => {
    if (!canEdit) return;
    setSavingAIMode(true);
    try {
      const { data } = await axiosClient.patch(
        `/chatrooms/${room.id}/ai-assistant`,
        {
          mode: aiMode,
        }
      );
      setAiMode(String(data.aiAssistantMode || aiMode).toUpperCase());
      onUpdated?.(data);
      onClose();
      notifications.show({ message: 'Settings updated', withBorder: true });
    } catch (error) {
      notifications.show({ message: error?.response?.data?.error || 'Could not save AI mode', color: 'red', withBorder: true });
    } finally {
      setSavingAIMode(false);
    }
  };

  const saveAutoTranslate = async (value) => {
    setSavingAutoTranslate(true);
    try {
      const { data } = await axiosClient.patch(
        `/chatrooms/${room.id}/auto-translate`,
        {
          mode: value,
        }
      );
      setAutoTranslateMode(String(data.autoTranslateMode || value).toUpperCase());
      onUpdated?.(data);
      notifications.show({ message: 'Settings updated', withBorder: true });
    } catch (error) {
      notifications.show({ message: error?.response?.data?.error || 'Could not save translation mode', color: 'red', withBorder: true });
    } finally {
      setSavingAutoTranslate(false);
    }
  };

  const toggleRoomBot = async (checked) => {
    setSavingRoomBot(true);
    try {
      const { data } = await axiosClient.patch(`/chatrooms/${room.id}/ai-enabled`, {
        enabled: checked,
      });
      setRoomBotEnabled(Boolean(data.allowForiaBot));
      onUpdated?.(data);
      notifications.show({ message: 'Settings updated', withBorder: true });
    } catch (error) {
      notifications.show({
        message: error?.response?.data?.error || 'Could not update room AI permission',
        color: 'red', withBorder: true,
      });
    } finally {
      setSavingRoomBot(false);
    }
  };

  const toggleAllowBot = async (checked) => {
    setSavingAllow(true);
    try {
      const { data } = await axiosClient.patch(`/chatrooms/${room.id}/ai-opt`, {
        allow: checked,
      });
      setAllowAIBot(!!data.allowAIBot);
      notifications.show({ message: 'Settings updated', withBorder: true });
    } catch (error) {
      notifications.show({ message: error?.response?.data?.error || 'Could not update your AI consent', color: 'red', withBorder: true });
    } finally {
      setSavingAllow(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('roomSettings.title', 'Room settings')}
      centered
      size="lg"
      withCloseButton
      closeOnEscape
      trapFocus
      aria-label="Room settings"
    >
      <Stack gap="lg">
        {/* Participants & Roles */}
        <div>
          <Group justify="space-between" mb="xs">
            <Text fw={600}>
              {t('roomSettings.participants', 'Participants')}
            </Text>
          </Group>

          {loadingParticipants ? (
            <Group justify="center" py="md">
              <Loader />
            </Group>
          ) : (
            <Table striped highlightOnHover className="room-settings-participants-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('roomSettings.user', 'User')}</Table.Th>
                  <Table.Th>{t('roomSettings.role', 'Role')}</Table.Th>
                  <Table.Th>{t('roomSettings.actions', 'Actions')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {participants.map(({ user, role }) => {
                  const isOwnerRow = String(user.id) === String(ownerId ?? room?.ownerId);
                  return (
                    <Table.Tr key={user.id}>
                      <Table.Td>
                        <Group gap="xs" className="room-settings-participant-identity" wrap="wrap">
                          <Avatar src={user.avatarUrl} radius="xl" size="sm" />
                          <Text className="room-settings-participant-username">{user.username}</Text>
                          {isOwnerRow && <Badge color="violet">
                            {t('roomSettings.owner', 'Owner')}
                          </Badge>}
                          {!isOwnerRow && role !== 'MEMBER' && (
                            <Badge>{role}</Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {isOwnerRow ? (
                          <Text c="dimmed">Owner</Text>
                        ) : canEdit ? (
                          <Select
                            className="room-settings-role-select"
                            value={role}
                            data={ROLE_OPTS}
                            onChange={(v) => v && changeRole(user.id, v)}
                            disabled={!isOwner && role === 'ADMIN'} // only owner can set/demote ADMINs
                            withinPortal
                          />
                        ) : (
                          <Badge variant="light">{role}</Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {isOwnerRow ? null : (
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            onClick={() => removeUser(user.id)}
                            disabled={!canEdit || removingUserId !== null}
                            loading={removingUserId === user.id}
                            aria-label={`Remove ${user.username || `user #${user.id}`}`}
                          >
                            {t('roomSettings.remove', 'Remove')}
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </div>

        {showExperimentalRoomControls && (
          <>
        <Divider />

        {/* Room-level AI assistant (owner/admin) */}
        {canEdit && (
          <Stack gap="sm">
            <Select
              label={t('roomSettings.aiAssistant', 'AI assistant')}
              data={AI_MODE_OPTS}
              value={aiMode}
              onChange={setAiMode}
              withinPortal
            />
            <Switch
              label="Enable Ria assistant for this room"
              description="Room-wide permission. Each member's personal consent is separate."
              checked={roomBotEnabled}
              onChange={(e) => toggleRoomBot(e.currentTarget.checked)}
              disabled={savingRoomBot}
            />
            <Group justify="flex-end">
              <Button
                onClick={saveAIMode}
                loading={savingAIMode}
                aria-label="Save AI assistant mode"
              >
                {t('roomSettings.saveAIMode', 'Save AI mode')}
              </Button>
            </Group>
          </Stack>
        )}

        {/* Auto-translation (owner/admin) */}
        {canEdit && (
          <Stack gap="sm">
            <Select
              label={t('roomSettings.autoTranslation', 'Auto-translation')}
              data={AUTO_TRANSLATE_OPTS}
              value={autoTranslateMode}
              onChange={(v) => v && saveAutoTranslate(v)}
              withinPortal
              disabled={savingAutoTranslate}
            />
          </Stack>
        )}

        <Divider />

        {/* Per-user preference in this room */}
        <Switch
          label="Allow Ria assistant for my messages in this room"
          checked={allowAIBot}
          onChange={(e) => toggleAllowBot(e.currentTarget.checked)}
          disabled={savingAllow}
        />
          </>
        )}
      </Stack>
    </Modal>
  );
}
