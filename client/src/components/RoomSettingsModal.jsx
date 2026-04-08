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

export default function RoomSettingsModal({
  opened,
  onClose,
  room,
  onUpdated,
}) {
  const { currentUser } = useUser();
  const canEdit = currentUser?.role === 'ADMIN' || currentUser?.id === room?.ownerId;
  const isOwner = currentUser?.id === room?.ownerId;

  const { t } = useTranslation();

  // Participants state
  const [ownerId, setOwnerId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  // Room-level settings
  const [aiMode, setAiMode] = useState(room?.aiAssistantMode || 'off');
  const [savingAIMode, setSavingAIMode] = useState(false);

  const [autoTranslateMode, setAutoTranslateMode] = useState(
    room?.autoTranslateMode || 'off'
  );
  const [savingAutoTranslate, setSavingAutoTranslate] = useState(false);

  // Per-user (in this room) preference
  const [allowAIBot, setAllowAIBot] = useState(room?.me?.allowAIBot ?? true);
  const [savingAllow, setSavingAllow] = useState(false);

  const ROLE_OPTS = [
  { value: 'MEMBER', label: t('roomSettings.roles.member', 'Member') },
  { value: 'MODERATOR', label: t('roomSettings.roles.moderator', 'Moderator') },
  { value: 'ADMIN', label: t('roomSettings.roles.admin', 'Admin') },
 ];

  const AI_MODE_OPTS = [
  { value: 'off', label: t('roomSettings.aiMode.off', 'Off') },
  { value: 'mention', label: t('roomSettings.aiMode.mention', 'Only on @ForiaBot or /ask') },
  { value: 'always', label: t('roomSettings.aiMode.always', 'Reply proactively') },
];

  const AUTO_TRANSLATE_OPTS = [
  { value: 'off', label: t('roomSettings.autoTranslateMode.off', 'Off') },
  { value: 'tagged', label: t('roomSettings.autoTranslateMode.tagged', 'Tagged only (/tr …)') },
  { value: 'all', label: t('roomSettings.autoTranslateMode.all', 'All messages') },
];

  // keep local state in sync when room prop changes
  useEffect(() => {
    setAiMode(room?.aiAssistantMode || 'off');
    setAutoTranslateMode(room?.autoTranslateMode || 'off');
    setAllowAIBot(room?.me?.allowAIBot ?? true);
  }, [
    room?.id,
    room?.aiAssistantMode,
    room?.autoTranslateMode,
    room?.me?.allowAIBot,
  ]);

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
    await axiosClient.patch(
      `/chatrooms/${room.id}/participants/${userId}/role`,
      { role }
    );
    await loadParticipants();
    notifications.show({ message: 'Settings updated', withBorder: true });
  };

  const removeUser = async (userId) => {
    await axiosClient.delete(`/chatrooms/${room.id}/participants/${userId}`);
    await loadParticipants();
    notifications.show({ message: 'Settings updated', withBorder: true });
  };

  // Room settings actions
  const saveAIMode = async () => {
    if (!canEdit) return onClose();
    setSavingAIMode(true);
    try {
      const { data } = await axiosClient.patch(
        `/chatrooms/${room.id}/ai-assistant`,
        {
          mode: aiMode,
        }
      );
      onUpdated?.(data);
      onClose();
      notifications.show({ message: 'Settings updated', withBorder: true });
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
      setAutoTranslateMode(data.autoTranslateMode || value);
      onUpdated?.(data);
      notifications.show({ message: 'Settings updated', withBorder: true });
    } finally {
      setSavingAutoTranslate(false);
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
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('roomSettings.user', 'User')}</Table.Th>
                  <Table.Th>{t('roomSettings.role', 'Role')}</Table.Th>
                  <Table.Th>{t('roomSettings.actions', 'Actions')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {participants.map(({ user, role }) => {
                  const isOwnerRow = user.id === ownerId;
                  return (
                    <Table.Tr key={user.id}>
                      <Table.Td>
                        <Group gap="xs">
                          <Avatar src={user.avatarUrl} radius="xl" size="sm" />
                          <Text>{user.username}</Text>
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
                            disabled={!canEdit}
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
          label={t('roomSettings.allowBot', 'Allow ForiaBot to engage in this room')}
          checked={allowAIBot}
          onChange={(e) => toggleAllowBot(e.currentTarget.checked)}
          disabled={savingAllow}
        />
      </Stack>
    </Modal>
  );
}
