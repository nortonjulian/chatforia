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

import BackupManager from '@/components/settings/BackupManager.jsx';
import ChatBackupManager from '@/components/ChatBackupManager.jsx';

// dynamic loader — keeps heavy crypto out of initial bundle
import loadEncryptionClient from '@/utils/loadEncryptionClient';

export default function SettingsBackups() {
  const [unlockPass, setUnlockPass] = useState('');
  const [unlockedKey, setUnlockedKey] = useState(null); // base64 private key
  const [status, setStatus] = useState('');

  async function onUnlock() {
    setStatus('Unlocking…');
    try {
      // dynamically import the encryption module only when needed
      const mod = await loadEncryptionClient();
      if (!mod?.unlockKeyBundle || typeof mod.unlockKeyBundle !== 'function') {
        throw new Error('Encryption client not available');
      }

      const { privateKey } = await mod.unlockKeyBundle(unlockPass);
      setUnlockedKey(privateKey);
      setStatus('Unlocked ✓');
    } catch (e) {
      // avoid leaking stack traces to UI, show friendly message
      console.error('Unlock failed', e);
      setStatus(e?.message ? `Error: ${e.message}` : 'Error: Unlock failed');
    }
  }

  // Example fetcher — replace with your real endpoint(s)
  const fetchAllMessages = useMemo(
    () => async () => {
      const res = await fetch('/messages/all?limit=5000', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch messages');
      return res.json(); // expects the same shape your app already uses
    },
    []
  );

  // If you have an endpoint to resolve public keys in bulk, call it here.
  // For a quick start, pass an empty map; your ChatBackupManager can handle/skip senders without keys.
  const senderPublicKeys = useMemo(() => ({}), []);

  return (
    <Stack gap="lg">
      <Title order={3}>Backups</Title>

      {/* Keys backup/restore */}
      <BackupManager />

      {/* Unlock to export chat backup */}
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

      {/* Chat backup/export (needs decrypted private key) */}
      <Card withBorder radius="md" p="lg">
        <ChatBackupManager
          fetchAllMessages={fetchAllMessages}
          // Intentionally omit currentUserId; your test expects it to be undefined
          currentUserPrivateKey={unlockedKey} // base64 private key (once unlocked)
          senderPublicKeys={senderPublicKeys} // map: senderId -> base64 publicKey (optional)
        />
      </Card>
    </Stack>
  );
}
