import { useState, useEffect } from 'react';
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
import { useTranslation } from 'react-i18next';

export default function KeyBackupManager() {
  const { currentUser, setNeedsKeyUnlock } = useUser();
  const { t } = useTranslation();

  // Export state
  const [unlockPasscode, setUnlockPasscode] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [busyExport, setBusyExport] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  // Import state
  const [importPassword, setImportPassword] = useState('');
  const [busyImport, setBusyImport] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const [hasAccountBackup, setHasAccountBackup] = useState(null);

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

      setExportMsg(
        t('keys.backupCreated', 'Key backup created and downloaded ✓')
      );
    } catch (e) {
      setExportMsg(
        t('common.errorWithMessage', 'Error: {{message}}', {
          message: e.message,
        })
      );
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
        throw new Error(
          t('keys.noBackup', 'No encrypted backup exists for this account')
        );
      }

      if (!payload?.publicKey) {
        throw new Error(
          t('keys.missingPublicKey', 'Backup is missing a public key')
        );
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

      await installLocalPrivateKeyBundle(bundle);

      const meta = await getLocalKeyBundleMeta();

      if (!serverKey || !meta?.publicKey || meta.publicKey !== serverKey) {
        throw new Error('Key restore incomplete or incorrect for this account');
      }

      setNeedsKeyUnlock(false);
      setImportMsg(
        t('keys.restored', 'Key backup restored ✓ Keys installed locally')
      );
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
    backupPassword.length < 8;

  const importDisabled =
  !importPassword || importPassword.length < 8;

    useEffect(() => {
      let mounted = true;

      async function checkBackup() {
        try {
          const { data } = await axiosClient.get('/auth/keys/backup');
          if (!mounted) return;
          setHasAccountBackup(Boolean(data?.hasBackup && data?.keys?.encryptedPrivateKeyBundle));
        } catch {
          if (!mounted) return;
          setHasAccountBackup(false);
        }
      }

      checkBackup();
      return () => {
        mounted = false;
      };
    }, []);

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Text fw={700}>Encryption Recovery</Text>
        <Text c="dimmed">
          Protect your encrypted chats with a Recovery Passcode. Use the same Recovery Passcode to restore your chats on iPhone, Android, and the web.
        </Text>

        <Divider label="Create Recovery Backup" />
        <Accordion>
          <Accordion.Item value="advanced">
            <Accordion.Control>
              Advanced Recovery Options
            </Accordion.Control>

            <Accordion.Panel>
              <PasswordInput
                label="Device Unlock Passcode"
                value={unlockPasscode}
                onChange={(e) => setUnlockPasscode(e.currentTarget.value)}
                description="Only needed when creating a downloadable backup file from this browser."
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        
        <PasswordInput
          label="Recovery Passcode"
          value={backupPassword}
          onChange={(e) => setBackupPassword(e.currentTarget.value)}
          description="Use at least 8 characters. You'll use this Recovery Passcode to restore chats on iPhone, Android, and the web."
        />
        <Group justify="flex-end">
          <Button onClick={onExport} loading={busyExport} disabled={exportDisabled}>
            Create Recovery Backup
          </Button>
        </Group>
        {exportMsg && (
          <Text c={exportMsg.startsWith('Error') ? 'red' : 'green'}>
            {exportMsg}
          </Text>
        )}

        <Divider label="Restore from account backup" />
        {hasAccountBackup === false && (
          <Text c="dimmed" size="sm">
            No Recovery Backup found. Create one so you can restore your encrypted chats on iPhone, Android, and the web.
          </Text>
        )}
        <PasswordInput
          label="Recovery Passcode"
          value={importPassword}
          onChange={(e) => setImportPassword(e.currentTarget.value)}
          description="Enter the Recovery Passcode you created on another device. Must be at least 8 characters."
        />
     
        <Group justify="flex-end">
          <Button onClick={onImport} loading={busyImport} disabled={importDisabled}>
            Restore Chats
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