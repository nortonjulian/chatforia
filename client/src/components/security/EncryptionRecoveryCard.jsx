import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Collapse,
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
  getLocalKeyBundleMeta,
  installLocalPrivateKeyBundle,
  unlockKeyBundle,
  persistUnlockPasscodeForSession,
} from '@/utils/encryptionClient';

export default function EncryptionRecoveryCard({
  blocked = false,
  title,
  description,
}) {
  const { t } = useTranslation();

  const {
    currentUser,
    setNeedsKeyUnlock,
    setKeyMeta,
    authError,
  } = useUser();

  const [unlockPasscode, setUnlockPasscode] = useState('');
  const [busyUnlock, setBusyUnlock] = useState(false);
  const [unlockMsg, setUnlockMsg] = useState('');

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [newLocalPasscode, setNewLocalPasscode] = useState('');
  const [busyImport, setBusyImport] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resetPasscode, setResetPasscode] = useState('');
  const [busyReset, setBusyReset] = useState(false);
  const [resetMsg, setResetMsg] = useState('');

  const serverKey = (currentUser?.publicKey || '').trim();

  const resolvedTitle =
    title ||
    t('encryptionRecovery.simpleTitle', 'Unlock encrypted messages');

  const resolvedDescription =
    description ||
    t(
      'encryptionRecovery.simpleDescription',
      'This browser needs your Chatforia encryption key before it can show encrypted messages.'
    );

  async function validateAndFinishRestore() {
    const meta = await getLocalKeyBundleMeta();

    if (!serverKey || !meta?.publicKey || meta.publicKey !== serverKey) {
      throw new Error(
        t(
          'encryptionRecovery.errors.restoreIncomplete',
          'Key restore incomplete or incorrect for this account.'
        )
      );
    }

    setKeyMeta(meta);
    setNeedsKeyUnlock(false);
  }

  const onUnlock = async () => {
    setBusyUnlock(true);
    setUnlockMsg('');

    try {
      await unlockKeyBundle(unlockPasscode);
      persistUnlockPasscodeForSession(unlockPasscode);
      await validateAndFinishRestore();

      setUnlockMsg(
        t(
          'encryptionRecovery.messages.keyUnlocked',
          'Encrypted messages unlocked.'
        )
      );
    } catch (e) {
      setUnlockMsg(
        `${t('common.error', 'Error')}: ${
          e?.message ||
          t(
            'encryptionRecovery.errors.unlockFailed',
            'Could not unlock encrypted messages.'
          )
        }`
      );
    } finally {
      setBusyUnlock(false);
    }
  };

  const onRestoreFromAccountBackup = async () => {
    setBusyImport(true);
    setImportMsg('');

    try {
      const { data } = await axiosClient.get('/auth/keys/backup');
      const payload = data?.keys;

      if (!data?.hasBackup || !payload?.encryptedPrivateKeyBundle) {
        throw new Error(
          t(
            'encryptionRecovery.errors.noBackup',
            'No encrypted backup exists for this account.'
          )
        );
      }

      if (!payload?.publicKey) {
        throw new Error(
          t(
            'encryptionRecovery.errors.missingPublicKey',
            'Backup is missing a public key.'
          )
        );
      }

      if (!serverKey) {
        throw new Error(
          t(
            'encryptionRecovery.errors.noServerPublicKey',
            'This account does not currently expose a server public key.'
          )
        );
      }

      if (payload.publicKey.trim() !== serverKey) {
        throw new Error(
          t(
            'encryptionRecovery.errors.serverBackupMismatch',
            'Server backup does not match the current account encryption key.'
          )
        );
      }

      const encryptedPayload =
        typeof payload.encryptedPrivateKeyBundle === 'string'
          ? JSON.parse(payload.encryptedPrivateKeyBundle)
          : payload.encryptedPrivateKeyBundle;

      const saltB64 = payload.privateKeyWrapSalt;
      const iterations = Number(payload.privateKeyWrapIterations || 250000);

      if (!saltB64 || !payload.privateKeyWrapKdf || !iterations) {
        throw new Error(
          t(
            'encryptionRecovery.errors.incompleteMetadata',
            'Backup metadata is incomplete.'
          )
        );
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

      setImportMsg(
        t(
          'encryptionRecovery.messages.keyRestored',
          'Encrypted chats restored on this browser.'
        )
      );
    } catch (e) {
      setImportMsg(
        `${t('common.error', 'Error')}: ${
          e?.message ||
          t(
            'encryptionRecovery.errors.restoreFailed',
            'Could not restore encrypted chats.'
          )
        }`
      );
    } finally {
      setBusyImport(false);
    }
  };

  const onReset = async () => {
    const confirmed = window.confirm(
      t(
        'encryptionRecovery.confirm.reset',
        'Start fresh encryption for this account?\n\nOlder encrypted messages may become unreadable unless you restore the original key later.'
      )
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
        resetPasscode
      );

      persistUnlockPasscodeForSession(resetPasscode);

      await axiosClient.post('/auth/keys/rotate', {
        publicKey,
        invalidateExistingBackup: true,
      });

      const meta = await getLocalKeyBundleMeta();

      if (!meta?.publicKey || meta.publicKey !== publicKey) {
        throw new Error(
          t(
            'encryptionRecovery.errors.resetIncomplete',
            'Encryption reset did not complete correctly.'
          )
        );
      }

      setKeyMeta(meta);
      setNeedsKeyUnlock(false);

      setResetMsg(
        t(
          'encryptionRecovery.messages.resetSuccess',
          'Fresh encryption has been set up on this browser.'
        )
      );
    } catch (e) {
      setResetMsg(
        `${t('common.error', 'Error')}: ${
          e?.message ||
          t(
            'encryptionRecovery.errors.resetFailed',
            'Could not reset encryption.'
          )
        }`
      );
    } finally {
      setBusyReset(false);
    }
  };

  const unlockDisabled = !unlockPasscode || unlockPasscode.length < 6;

  const restoreDisabled =
    !importPassword ||
    importPassword.length < 6 ||
    !newLocalPasscode ||
    newLocalPasscode.length < 6;

  const resetDisabled = !resetPasscode || resetPasscode.length < 6;

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <div>
          <Title order={blocked ? 2 : 4}>{resolvedTitle}</Title>
          <Text c="dimmed" mt={4}>
            {resolvedDescription}
          </Text>
        </div>

        {blocked && (
          <Alert
            color="yellow"
            title={t(
              'encryptionRecovery.alert.lockedTitle',
              'Encrypted chats locked'
            )}
          >
            {authError ||
              t(
                'encryptionRecovery.alert.lockedBody',
                'You can still use Chatforia, but encrypted messages are hidden until this browser is unlocked.'
              )}
          </Alert>
        )}

        <Stack gap="sm">
          <PasswordInput
            label={t(
              'encryptionRecovery.fields.devicePasscode.label',
              'Device passcode'
            )}
            value={unlockPasscode}
            onChange={(e) => setUnlockPasscode(e.currentTarget.value)}
            description={t(
              'encryptionRecovery.fields.devicePasscode.description',
              'Used to unlock encrypted chats on this browser.'
            )}
          />

          <Group justify="flex-end">
            <Button
              onClick={onUnlock}
              loading={busyUnlock}
              disabled={unlockDisabled}
            >
              {t(
                'encryptionRecovery.actions.unlockMessages',
                'Unlock messages'
              )}
            </Button>
          </Group>

          {!!unlockMsg && (
            <Text c={unlockMsg.startsWith('Error:') ? 'red' : 'green'} size="sm">
              {unlockMsg}
            </Text>
          )}
        </Stack>

        <Divider />

        <Stack gap="xs">
          <Button
            variant="subtle"
            justify="space-between"
            onClick={() => setRestoreOpen((v) => !v)}
          >
            {t(
              'encryptionRecovery.actions.restoreEncryptedChats',
              'Restore encrypted chats'
            )}
          </Button>

          <Collapse in={restoreOpen}>
            <Stack gap="sm" mt="sm">
              <Text c="dimmed" size="sm">
                {t(
                  'encryptionRecovery.restoreDescription',
                  'Use the backup password you created earlier, then choose a new passcode for this browser.'
                )}
              </Text>

              <PasswordInput
                label={t(
                  'encryptionRecovery.fields.restoreBackupPassword.label',
                  'Backup password'
                )}
                value={importPassword}
                onChange={(e) => setImportPassword(e.currentTarget.value)}
                description={t(
                  'encryptionRecovery.fields.restoreBackupPassword.description',
                  'The password you used when creating your encrypted backup.'
                )}
              />

              <PasswordInput
                label={t(
                  'encryptionRecovery.fields.newDevicePasscode.label',
                  'New device passcode'
                )}
                value={newLocalPasscode}
                onChange={(e) => setNewLocalPasscode(e.currentTarget.value)}
                description={t(
                  'encryptionRecovery.fields.newDevicePasscode.description',
                  'Used to protect your encrypted chats on this browser.'
                )}
              />

              <Group justify="flex-end">
                <Button
                  onClick={onRestoreFromAccountBackup}
                  loading={busyImport}
                  disabled={restoreDisabled}
                >
                  {t(
                    'encryptionRecovery.actions.restoreChats',
                    'Restore chats'
                  )}
                </Button>
              </Group>

              {!!importMsg && (
                <Text
                  c={importMsg.startsWith('Error:') ? 'red' : 'green'}
                  size="sm"
                >
                  {importMsg}
                </Text>
              )}
            </Stack>
          </Collapse>
        </Stack>

        <Divider />

        <Stack gap="xs">
          <Button
            variant="subtle"
            color="red"
            justify="space-between"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {t(
              'encryptionRecovery.actions.advancedRecovery',
              'Advanced recovery'
            )}
          </Button>

          <Collapse in={advancedOpen}>
            <Stack gap="sm" mt="sm">
              <Alert
                color="red"
                title={t(
                  'encryptionRecovery.danger.title',
                  'Start fresh encryption'
                )}
              >
                {t(
                  'encryptionRecovery.danger.body',
                  'Only use this if you cannot unlock or restore your existing key. Older encrypted messages may become unreadable.'
                )}
              </Alert>

              <PasswordInput
                label={t(
                  'encryptionRecovery.fields.resetDevicePasscode.label',
                  'New device passcode'
                )}
                value={resetPasscode}
                onChange={(e) => setResetPasscode(e.currentTarget.value)}
                description={t(
                  'encryptionRecovery.fields.resetDevicePasscode.description',
                  'This will protect the new encryption key on this browser.'
                )}
              />

              <Group justify="flex-end">
                <Button
                  color="red"
                  variant="filled"
                  onClick={onReset}
                  loading={busyReset}
                  disabled={resetDisabled}
                >
                  {t(
                    'encryptionRecovery.actions.startFreshEncryption',
                    'Start fresh encryption'
                  )}
                </Button>
              </Group>

              {!!resetMsg && (
                <Text
                  c={resetMsg.startsWith('Error:') ? 'red' : 'green'}
                  size="sm"
                >
                  {resetMsg}
                </Text>
              )}
            </Stack>
          </Collapse>
        </Stack>
      </Stack>
    </Card>
  );
}