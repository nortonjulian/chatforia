import React, {
  useMemo,
} from 'react';

import {
  Stack,
  Text,
  Title,
} from '@mantine/core';

import ChatBackupManager from '@/components/settings/ChatBackupManager.jsx';

export default function SettingsBackups() {
  const fetchAllMessages = useMemo(
    () => async () => {
      const response =
        await fetch(
          '/messages/all?limit=5000',
          {
            credentials: 'include',
          }
        );

      if (!response.ok) {
        throw new Error(
          'Failed to fetch messages'
        );
      }

      return response.json();
    },
    []
  );

  return (
    <div
      style={{
        height:
          'calc(100dvh - 120px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        paddingBottom: 32,
      }}
    >
      <Stack gap="lg">
        <div>
          <Title order={3}>
            Chat History Backups
          </Title>

          <Text
            c="dimmed"
            mt="xs"
          >
            Export encrypted copies of
            your chat history.
          </Text>
        </div>

        <ChatBackupManager
          fetchPage={fetchAllMessages}
        />
      </Stack>
    </div>
  );
}
