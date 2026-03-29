import { useState } from 'react';
import {
  Button,
  Card,
  FileInput,
  Group,
  Stack,
  Text,
  PasswordInput,
  Divider,
} from '@mantine/core';
import {
  createEncryptedChatBackup,
  restoreEncryptedChatBackup,
} from '../../utils/backupClient.js';

export default function ChatBackupManager({
  currentUserId,
  roomId,
  fetchPage,
  fetchPublicKeys,
}) {
  const [backupPassword, setBackupPassword] = useState('');
  const [localPasscode, setLocalPasscode] = useState('');
  const [restoreFile, setRestoreFile] = useState(null);

  const [busyExport, setBusyExport] = useState(false);
  const [busyImport, setBusyImport] = useState(false);
  const [status, setStatus] = useState('');

  const exportDisabled =
    !currentUserId ||
    !roomId ||
    !fetchPage ||
    !localPasscode ||
    localPasscode.length < 6 ||
    !backupPassword ||
    backupPassword.length < 6;

  const importDisabled =
    !restoreFile ||
    !backupPassword ||
    backupPassword.length < 6;

  async function handleChatBackup() {
    setBusyExport(true);
    setStatus('');

    try {
      const { blob, filename } = await createEncryptedChatBackup({
        roomId,
        currentUserId,
        passcodeToUnlockKeys: localPasscode,
        password: backupPassword,
        fetchPage,
        fetchPublicKeys,
        includeMedia: true,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setStatus(`Chat backup created and downloaded: ${filename}`);
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusyExport(false);
    }
  }

  async function handleChatRestore() {
    setBusyImport(true);
    setStatus('');

    try {
      const result = await restoreEncryptedChatBackup({
        file: restoreFile,
        password: backupPassword,
      });

      setStatus(
        `Chat backup restored with ${result?.messages?.length || 0} messages`
      );
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusyImport(false);
    }
  }

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Text fw={700}>Chat Backup & Restore</Text>
        <Text c="dimmed">
          Export an encrypted backup of chat history and restore it later with
          your backup password.
        </Text>

        <Divider label="Create chat backup" />

        <PasswordInput
          label="Unlock passcode (current device)"
          value={localPasscode}
          onChange={(e) => setLocalPasscode(e.currentTarget.value)}
          description="Used to decrypt keys locally before exporting chats"
        />

        <PasswordInput
          label="Backup password"
          value={backupPassword}
          onChange={(e) => setBackupPassword(e.currentTarget.value)}
          description="Used to encrypt the chat backup file"
        />

        <Group justify="flex-end">
          <Button
            onClick={handleChatBackup}
            loading={busyExport}
            disabled={exportDisabled}
          >
            Download encrypted chat backup
          </Button>
        </Group>

        <Divider label="Restore chat backup" />

        <FileInput
          label="Backup file (.json)"
          value={restoreFile}
          onChange={setRestoreFile}
          placeholder="Select backup file"
          accept="application/json"
        />

        <PasswordInput
          label="Backup password"
          value={backupPassword}
          onChange={(e) => setBackupPassword(e.currentTarget.value)}
        />

        <Group justify="flex-end">
          <Button
            onClick={handleChatRestore}
            loading={busyImport}
            disabled={importDisabled}
          >
            Restore chat backup
          </Button>
        </Group>

        {status && (
          <Text c={status.startsWith('Error') ? 'red' : 'green'}>
            {status}
          </Text>
        )}
      </Stack>
    </Card>
  );
}