import React, { useMemo, useState } from 'react';
import {
  Card,
  Stack,
  Title,
  PasswordInput,
  Group,
  Button,
  Text,
} from '@mantine/core';

import KeyBackupManager from '@/components/KeyBackupManager.jsx';
import ChatBackupManager from '@/components/settings/ChatBackupManager.jsx';

import loadEncryptionClient from '@/utils/loadEncryptionClient';

export default function SettingsBackups() {
  const [unlockPass, setUnlockPass] = useState('');
  const [status, setStatus] = useState('');

  async function onUnlock() {
    setStatus('Unlocking…');
    try {
      const mod = await loadEncryptionClient();
      if (!mod?.unlockKeyBundle || typeof mod.unlockKeyBundle !== 'function') {
        throw new Error('Encryption client not available');
      }

      await mod.unlockKeyBundle(unlockPass);
      setStatus('Unlocked ✓');
    } catch (e) {
      console.error('Unlock failed', e);
      setStatus(e?.message ? `Error: ${e.message}` : 'Error: Unlock failed');
    }
  }

  const fetchAllMessages = useMemo(
    () => async () => {
      const res = await fetch('/messages/all?limit=5000', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch messages');
      return res.json();
    },
    []
  );

  return (
    <div
      style={{
        height: 'calc(100dvh - 120px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        paddingBottom: 32,
      }}
    >
      <Stack gap="lg">
        <Title order={3}>Backups</Title>

        <KeyBackupManager />

        <Card withBorder radius="md" p="lg">
          <Stack gap="sm">
            <Title order={5}>Unlock for Chat Backup</Title>
            <PasswordInput
              label="Unlock passcode"
              description="Enter your device passcode to decrypt keys for export"
              value={unlockPass}
              onChange={(e) => setUnlockPass(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button onClick={onUnlock} disabled={!unlockPass || unlockPass.length < 6}>
                Unlock
              </Button>
            </Group>
            {status && (
              <Text c={status.startsWith('Error') ? 'red' : 'green'}>
                {status}
              </Text>
            )}
          </Stack>
        </Card>

        <ChatBackupManager fetchPage={fetchAllMessages} />
      </Stack>
    </div>
  );
}