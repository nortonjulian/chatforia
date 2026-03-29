import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  PasswordInput,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';
import {
  createEncryptedKeyBackup,
} from '@/utils/backupClient';
import {
  getLocalKeyBundleMeta,
  installLocalPrivateKeyBundle,
  unlockKeyBundle,
  persistUnlockPasscodeForSession,
} from '@/utils/encryptionClient';

export default function EncryptionRecoveryCard({
  blocked = false,
  title = 'Manage Encryption',
  description = 'Back up, restore, unlock, or reset your encryption key.',
}) {
  const {
    currentUser,
    setNeedsKeyUnlock,
    setKeyMeta,
    authError,
  } = useUser();

  const [unlockPasscode, setUnlockPasscode] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [busyExport, setBusyExport] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const [importPassword, setImportPassword] = useState('');
  const [newLocalPasscode, setNewLocalPasscode] = useState('');
  const [busyImport, setBusyImport] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const [busyReset, setBusyReset] = useState(false);
  const [resetMsg, setResetMsg] = useState('');

  const serverKey = (currentUser?.publicKey || '').trim();

  async function validateAndFinishRestore() {
    const meta = await getLocalKeyBundleMeta();

    if (!serverKey || !meta?.publicKey || meta.publicKey !== serverKey) {
      throw new Error('Key restore incomplete or incorrect for this account');
    }

    setKeyMeta(meta);
    setNeedsKeyUnlock(false);
  }

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

      setExportMsg('Key backup created and downloaded.');
    } catch (e) {
      setExportMsg(`Error: ${e.message}`);
    } finally {
      setBusyExport(false);
    }
  };

  const onUnlock = async () => {
    setBusyExport(true);
    setExportMsg('');

    try {
      await unlockKeyBundle(unlockPasscode);
      persistUnlockPasscodeForSession(unlockPasscode);

      await validateAndFinishRestore();

      setExportMsg('Encryption key unlocked.');
    } catch (e) {
      setExportMsg(`Error: ${e.message}`);
    } finally {
      setBusyExport(false);
    }
  };

  const onRestoreFromAccountBackup = async () => {
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

      persistUnlockPasscodeForSession(newLocalPasscode);

       await installLocalPrivateKeyBundle(bundle, newLocalPasscode);

      await validateAndFinishRestore();
      setImportMsg('Key restored from account backup.');
    } catch (e) {
      setImportMsg(`Error: ${e.message}`);
    } finally {
      setBusyImport(false);
    }
  };

  const onReset = async () => {
    const confirmed = window.confirm(
      'Reset encryption for this account?\n\nOlder encrypted messages may become unreadable unless you restore the original key later.'
    );
    if (!confirmed) return;

    setBusyReset(true);
    setResetMsg('');

    try {
      const mod = await import('@/utils/encryptionClient');
      const nacl = (await import('tweetnacl')).default;
      const naclUtil = await import('tweetnacl-util');

      const pair = nacl.box.keyPair();
      const publicKey = naclUtil.encodeBase64(pair.publicKey);
      const privateKey = naclUtil.encodeBase64(pair.secretKey);

      await mod.installLocalPrivateKeyBundle(
        { publicKey, privateKey },
        newLocalPasscode || importPassword || backupPassword || '123456'
      );

      persistUnlockPasscodeForSession(newLocalPasscode);

      await axiosClient.post('/auth/keys/rotate', {
        publicKey,
        invalidateExistingBackup: true,
      });

      const meta = await getLocalKeyBundleMeta();
      if (!meta?.publicKey || meta.publicKey !== publicKey) {
        throw new Error('Encryption reset did not complete correctly');
      }

      setKeyMeta(meta);
      setNeedsKeyUnlock(false);
      setResetMsg('Encryption reset successfully.');
    } catch (e) {
      setResetMsg(`Error: ${e.message}`);
    } finally {
      setBusyReset(false);
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

  const resetDisabled =
    !newLocalPasscode || newLocalPasscode.length < 6;

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <div>
          <Title order={blocked ? 2 : 4}>{title}</Title>
          <Text c="dimmed" mt={4}>
            {description}
          </Text>
        </div>

        {blocked && (
          <Alert color="yellow" title="Encryption key required">
            {authError ||
              'This browser cannot currently decrypt your encrypted messages. Restore, unlock, or reset your key to continue.'}
          </Alert>
        )}

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
          <Button onClick={onUnlock} loading={busyExport} disabled={!unlockPasscode || unlockPasscode.length < 6}>
            Unlock encryption key
          </Button>
        </Group>
        {!!exportMsg && (
          <Text c={exportMsg.startsWith('Error:') ? 'red' : 'green'}>
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
          <Button
            onClick={onRestoreFromAccountBackup}
            loading={busyImport}
            disabled={importDisabled}
          >
            Restore from account backup
          </Button>
        </Group>
        {!!importMsg && (
          <Text c={importMsg.startsWith('Error:') ? 'red' : 'green'}>
            {importMsg}
          </Text>
        )}

        <Divider label="Reset encryption" />

        <Text c="dimmed" size="sm">
          This generates a new encryption key for your account. Older encrypted messages may become
          unreadable unless you restore the original key later.
        </Text>

        <PasswordInput
          label="New local passcode"
          value={newLocalPasscode}
          onChange={(e) => setNewLocalPasscode(e.currentTarget.value)}
          description="Required before resetting so the new key is protected on this device"
        />

        <Group justify="flex-end">
          <Button
            color="red"
            variant="filled"
            onClick={onReset}
            loading={busyReset}
            disabled={resetDisabled}
          >
            Reset Encryption
          </Button>
        </Group>
        {!!resetMsg && (
          <Text c={resetMsg.startsWith('Error:') ? 'red' : 'green'}>
            {resetMsg}
          </Text>
        )}
      </Stack>
    </Card>
  );
}