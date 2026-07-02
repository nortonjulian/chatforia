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
  TextInput,
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

  const [helpOpen, setHelpOpen] = useState(false);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resetPasscode, setResetPasscode] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [busyReset, setBusyReset] = useState(false);
  const [resetMsg, setResetMsg] = useState('');

  const serverKey = (currentUser?.publicKey || '').trim();

  const resolvedTitle =
    title ||
    t('encryptionRecovery.simpleTitle', 'Unlock secure messages');

  const resolvedDescription =
    description ||
    t(
      'encryptionRecovery.simpleDescription',
      'Enter your Secure Messages Passcode to view secure messages on this browser.'
    );

  async function validateAndFinishRestore() {
    const meta = await getLocalKeyBundleMeta();

    if (!serverKey || !meta?.publicKey || meta.publicKey !== serverKey) {
      throw new Error(
        t(
          'encryptionRecovery.errors.restoreIncomplete',
          'Secure message restore is incomplete or incorrect for this account.'
        )
      );
    }

    setKeyMeta(meta);
    setNeedsKeyUnlock(false);
  }

  async function restoreFromAccountBackup(passcode) {
    const { data } = await axiosClient.get('/auth/keys/backup');
    const payload = data?.keys;

    if (!data?.hasBackup || !payload?.encryptedPrivateKeyBundle) {
      throw new Error(
        t(
          'encryptionRecovery.errors.noBackup',
          'No secure message recovery backup exists for this account.'
        )
      );
    }

    if (!payload?.publicKey) {
      throw new Error(
        t(
          'encryptionRecovery.errors.missingPublicKey',
          'Recovery backup is missing a public key.'
        )
      );
    }

    if (!serverKey) {
      throw new Error(
        t(
          'encryptionRecovery.errors.noServerPublicKey',
          'This account does not currently expose a secure message key.'
        )
      );
    }

    if (payload.publicKey.trim() !== serverKey) {
      throw new Error(
        t(
          'encryptionRecovery.errors.serverBackupMismatch',
          'Recovery backup does not match the current account secure message key.'
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
          'Recovery backup metadata is incomplete.'
        )
      );
    }

    const te = new TextEncoder();
    const td = new TextDecoder();
    const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      te.encode(passcode),
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

    persistUnlockPasscodeForSession(passcode);
    await installLocalPrivateKeyBundle(bundle, passcode);
    await validateAndFinishRestore();

    return true;
  }

  const onUnlock = async () => {
    const passcode = unlockPasscode.trim();

    setBusyUnlock(true);
    setUnlockMsg('');
    setResetMsg('');

    try {
      try {
        await unlockKeyBundle(passcode);
        persistUnlockPasscodeForSession(passcode);
        await validateAndFinishRestore();

        setUnlockMsg(
          t(
            'encryptionRecovery.messages.keyUnlocked',
            'Secure messages unlocked.'
          )
        );

        return;
      } catch (localError) {
        console.warn('[EncryptionRecoveryCard] local unlock failed, trying account recovery', {
          message: localError?.message || localError,
        });
      }

      await restoreFromAccountBackup(passcode);

      setUnlockMsg(
        t(
          'encryptionRecovery.messages.keyRestored',
          'Secure messages restored on this browser.'
        )
      );
    } catch (e) {
      console.warn('[EncryptionRecoveryCard] unlock/recovery failed', {
        message: e?.message || e,
      });

      setUnlockMsg(
        `${t('common.error', 'Error')}: ${t(
          'encryptionRecovery.errors.unlockOrRestoreFailed',
          'That passcode did not unlock your secure messages. Try again, or approve this browser from a signed-in device. Only start fresh if you cannot recover your secure messages.'
        )}`
      );
    } finally {
      setBusyUnlock(false);
    }
  };

  const onReset = async () => {
    if (resetConfirm.trim() !== 'START FRESH') {
      setResetMsg(
        `${t('common.error', 'Error')}: ${t(
          'encryptionRecovery.errors.startFreshConfirmRequired',
          'Type START FRESH to continue.'
        )}`
      );
      return;
    }

    const confirmed = window.confirm(
      t(
        'encryptionRecovery.confirm.reset',
        'Start fresh with secure messages?\n\nThis creates a new secure message key for your account. Older app-to-app secure messages may no longer be readable on any device.\n\nSMS/text message conversations are not affected.'
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
      const passcode = resetPasscode.trim();

      await mod.installLocalPrivateKeyBundle(
        { publicKey, privateKey },
        passcode
      );

      persistUnlockPasscodeForSession(passcode);

      await axiosClient.post('/auth/keys/rotate', {
        publicKey,
        invalidateExistingBackup: true,
      });

      const meta = await getLocalKeyBundleMeta();

      if (!meta?.publicKey || meta.publicKey !== publicKey) {
        throw new Error(
          t(
            'encryptionRecovery.errors.resetIncomplete',
            'Secure messages were not set up correctly.'
          )
        );
      }

      setKeyMeta(meta);
      setNeedsKeyUnlock(false);

      setResetMsg(
        t(
          'encryptionRecovery.messages.resetSuccess',
          'Fresh secure messages have been set up on this browser.'
        )
      );
    } catch (e) {
      setResetMsg(
        `${t('common.error', 'Error')}: ${
          e?.message ||
          t(
            'encryptionRecovery.errors.resetFailed',
            'Could not start fresh with secure messages.'
          )
        }`
      );
    } finally {
      setBusyReset(false);
    }
  };

  const unlockDisabled =
    !unlockPasscode || unlockPasscode.trim().length < 6;

  const resetDisabled =
    busyReset ||
    !resetPasscode ||
    resetPasscode.trim().length < 8 ||
    resetConfirm.trim() !== 'START FRESH';

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
              'Secure messages locked'
            )}
          >
            {authError ||
              t(
                'encryptionRecovery.alert.lockedBody',
                'You can still use Chatforia, but secure messages are hidden until this browser is unlocked.'
              )}
          </Alert>
        )}

        <Stack gap="sm">
          <PasswordInput
            label={t(
              'encryptionRecovery.fields.secureMessagesPasscode.label',
              'Secure Messages Passcode'
            )}
            value={unlockPasscode}
            onChange={(e) => setUnlockPasscode(e.currentTarget.value)}
            description={t(
              'encryptionRecovery.fields.secureMessagesPasscode.description',
              'Use the passcode you created for secure messages. Chatforia will try this browser first, then your account recovery backup.'
            )}
          />

          <Group justify="flex-end">
            <Button
              onClick={onUnlock}
              loading={busyUnlock}
              disabled={unlockDisabled}
            >
              {t(
                'encryptionRecovery.actions.unlockSecureMessages',
                'Unlock secure messages'
              )}
            </Button>
          </Group>

          {!!unlockMsg && (
            <Text
              c={unlockMsg.startsWith('Error:') ? 'red' : 'green'}
              size="sm"
            >
              {unlockMsg}
            </Text>
          )}
        </Stack>

        <Divider />

        <Stack gap="xs">
          <Group justify="center">
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setHelpOpen((v) => !v)}
            >
              {t(
                'encryptionRecovery.actions.havingTrouble',
                'Having trouble unlocking?'
              )}
            </Button>
          </Group>

          <Collapse in={helpOpen}>
            <Stack gap="xs" mt="sm">
              <Text c="dimmed" size="sm">
                {t(
                  'encryptionRecovery.help.primary',
                  'Make sure you are using the Secure Messages Passcode you created when secure messages were set up.'
                )}
              </Text>

              <Text c="dimmed" size="sm">
                {t(
                  'encryptionRecovery.help.recovery',
                  'If this browser has not been unlocked before, Chatforia will automatically try your account recovery backup with the same passcode.'
                )}
              </Text>

              <Text c="dimmed" size="sm">
                {t(
                  'encryptionRecovery.help.devicePairing',
                  'If you are signed in on another device, you may also be able to approve this browser from that device.'
                )}
              </Text>
            </Stack>
          </Collapse>
        </Stack>

        <Divider />

        <Stack gap="xs">
          <Group justify="center">
            <Button
              variant="subtle"
              color="red"
              size="sm"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {t(
                'encryptionRecovery.actions.cannotRecover',
                'I cannot recover my secure messages'
              )}
            </Button>
          </Group>

          <Collapse in={advancedOpen}>
            <Stack gap="sm" mt="sm">
              <Alert
                color="red"
                title={t(
                  'encryptionRecovery.danger.title',
                  'Start fresh with secure messages'
                )}
              >
                {t(
                  'encryptionRecovery.danger.body',
                  'Only use this as a last resort. This creates a new secure message key for your account. Older app-to-app secure messages may no longer be readable on any device. SMS/text message conversations are not affected.'
                )}
              </Alert>

              <PasswordInput
                label={t(
                  'encryptionRecovery.fields.resetSecureMessagesPasscode.label',
                  'New Secure Messages Passcode'
                )}
                value={resetPasscode}
                onChange={(e) => setResetPasscode(e.currentTarget.value)}
                description={t(
                  'encryptionRecovery.fields.resetSecureMessagesPasscode.description',
                  'Use at least 8 characters. This passcode will protect secure messages on this browser.'
                )}
              />

              <TextInput
                label={t(
                  'encryptionRecovery.fields.startFreshConfirm.label',
                  'Type START FRESH to continue'
                )}
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.currentTarget.value)}
                description={t(
                  'encryptionRecovery.fields.startFreshConfirm.description',
                  'This helps prevent accidental secure message resets.'
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
                    'encryptionRecovery.actions.startFreshSecureMessages',
                    'Start fresh with secure messages'
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