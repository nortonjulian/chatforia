import { useState } from 'react';
import {
  Button,
  Card,
  Group,
  Stack,
  Text,
  PasswordInput,
  Divider,
} from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import {
  createEncryptedKeyBackup,
} from '../utils/backupClient.js';
import {
  getLocalKeyBundleMeta,
  installLocalPrivateKeyBundle,
} from '@/utils/encryptionClient';
import { useUser } from '@/context/UserContext';

export default function KeyBackupManager() {
  const { currentUser, setNeedsKeyUnlock } = useUser();

  // Export state
  const [unlockPasscode, setUnlockPasscode] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [busyExport, setBusyExport] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  // Import state
  const [importPassword, setImportPassword] = useState('');
  const [newLocalPasscode, setNewLocalPasscode] = useState('');
  const [busyImport, setBusyImport] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const onExport = async () => {
    setBusyExport(true);
    setExportMsg('');

    try {
      const { blob, filename } = await createEncryptedKeyBackup({
        unlockPasscode,
        backupPassword,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setExportMsg('Key backup created and downloaded ✓');
    } catch (e) {
      setExportMsg(`Error: ${e.message}`);
    } finally {
      setBusyExport(false);
    }
  };

  const onImport = async () => {
    setBusyImport(true);
    setImportMsg('');

    try {
      const { data } = await axiosClient.get('/auth/keys/backup');
      const payload = data?.keys;

      if (!data?.hasBackup || !payload?.encryptedPrivateKeyBundle) {
        throw new Error('No encrypted backup exists for this account');
      }

      if (!payload?.publicKey) {
        throw new Error('Backup is missing a public key');
      }

      const serverKey = (currentUser?.publicKey || '').trim();
      if (!serverKey) {
        throw new Error('This account does not currently expose a server public key');
      }

      if (payload.publicKey.trim() !== serverKey) {
        throw new Error('Server backup does not match the current account encryption key');
      }

      const encryptedPayload =
        typeof payload.encryptedPrivateKeyBundle === 'string'
          ? JSON.parse(payload.encryptedPrivateKeyBundle)
          : payload.encryptedPrivateKeyBundle;

      const saltB64 = payload.privateKeyWrapSalt;
      const iterations = Number(payload.privateKeyWrapIterations || 250000);

      if (!saltB64 || !payload.privateKeyWrapKdf || !iterations) {
        throw new Error('Backup metadata is incomplete');
      }

      const te = new TextEncoder();
      const td = new TextDecoder();

      const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        te.encode(importPassword),
        'PBKDF2',
        false,
        ['deriveKey']
      );

      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: ub64(saltB64),
          iterations,
          hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ub64(encryptedPayload.ivB64),
        },
        key,
        ub64(encryptedPayload.ctB64)
      );

      const bundle = JSON.parse(td.decode(plaintext));

      await installLocalPrivateKeyBundle(bundle, newLocalPasscode);

      const meta = await getLocalKeyBundleMeta();

      if (!serverKey || !meta?.publicKey || meta.publicKey !== serverKey) {
        throw new Error('Key restore incomplete or incorrect for this account');
      }

      setNeedsKeyUnlock(false);
      setImportMsg('Key backup restored ✓ Keys installed locally');
    } catch (e) {
      setImportMsg(`Error: ${e.message}`);
    } finally {
      setBusyImport(false);
    }
  };

  const exportDisabled =
    !unlockPasscode ||
    unlockPasscode.length < 6 ||
    !backupPassword ||
    backupPassword.length < 6;

  const importDisabled =
    !importPassword ||
    importPassword.length < 6 ||
    !newLocalPasscode ||
    newLocalPasscode.length < 6;

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Text fw={700}>Encrypted Key Backups</Text>
        <Text c="dimmed">
          Create a local encrypted backup from this browser, or restore directly from your
          Chatforia account backup.
        </Text>

        <Divider label="Create key backup" />
        <PasswordInput
          label="Unlock passcode (current device)"
          value={unlockPasscode}
          onChange={(e) => setUnlockPasscode(e.currentTarget.value)}
          description="Used to decrypt your keys locally before exporting"
        />
        <PasswordInput
          label="Backup password"
          value={backupPassword}
          onChange={(e) => setBackupPassword(e.currentTarget.value)}
          description="Used to encrypt the backup file"
        />
        <Group justify="flex-end">
          <Button onClick={onExport} loading={busyExport} disabled={exportDisabled}>
            Download encrypted key backup
          </Button>
        </Group>
        {exportMsg && (
          <Text c={exportMsg.startsWith('Error') ? 'red' : 'green'}>
            {exportMsg}
          </Text>
        )}

        <Divider label="Restore from account backup" />
        <PasswordInput
          label="Backup password"
          value={importPassword}
          onChange={(e) => setImportPassword(e.currentTarget.value)}
          description="The password you created when backing up your key on iPhone"
        />
        <PasswordInput
          label="New local passcode"
          value={newLocalPasscode}
          onChange={(e) => setNewLocalPasscode(e.currentTarget.value)}
          description="Protect keys at rest on this browser"
        />
        <Group justify="flex-end">
          <Button onClick={onImport} loading={busyImport} disabled={importDisabled}>
            Restore from account backup
          </Button>
        </Group>
        {importMsg && (
          <Text c={importMsg.startsWith('Error') ? 'red' : 'green'}>
            {importMsg}
          </Text>
        )}
      </Stack>
    </Card>
  );
}