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
  clearPendingLocalPrivateKeyBundle,
  getLocalKeyBundleMeta,
  getUnlockedPrivateKeyForPublicKey,
  persistUnlockPasscodeForSession,
  promotePendingLocalPrivateKeyBundle,
  stagePendingLocalPrivateKeyBundle,
  tryPromotePendingLocalPrivateKeyBundle,
  unlockKeyBundle,
} from '@/utils/encryptionClient';
import {
  restoreRemoteKeyBackupToLocal,
} from '@/utils/keyBackupRemote';

export default function EncryptionRecoveryCard({
  blocked = false,
  title,
  description,
}) {
  const { t } = useTranslation();

  const {
    currentUser,
    setCurrentUser,
    setNeedsKeyUnlock,
    setKeyMeta,
    authError,
    refreshSession,
  } = useUser();

  const [unlockPasscode, setUnlockPasscode] =
    useState('');

  const [busyUnlock, setBusyUnlock] =
    useState(false);

  const [unlockMsg, setUnlockMsg] =
    useState('');

  const [helpOpen, setHelpOpen] =
    useState(false);

  const [advancedOpen, setAdvancedOpen] =
    useState(false);

  const [resetPasscode, setResetPasscode] =
    useState('');

  const [resetConfirm, setResetConfirm] =
    useState('');

  const [busyReset, setBusyReset] =
    useState(false);

  const [resetMsg, setResetMsg] =
    useState('');

  const serverKey =
    (currentUser?.publicKey || '').trim();

  const resolvedTitle =
    title ||
    t(
      'encryptionRecovery.simpleTitle',
      'Unlock secure messages'
    );

  const resolvedDescription =
    description ||
    t(
      'encryptionRecovery.simpleDescription',
      'Enter your Secure Messages Passcode to view secure messages on this browser.'
    );

  async function validateAndFinishRestore(
    expectedPublicKey = serverKey
  ) {
    if (!expectedPublicKey) {
      throw new Error(
        'This account does not currently expose a secure message key.'
      );
    }

    await getUnlockedPrivateKeyForPublicKey(
      expectedPublicKey
    );

    const meta =
      await getLocalKeyBundleMeta();

    if (
      !meta?.publicKey ||
      meta.publicKey !== expectedPublicKey
    ) {
      throw new Error(
        'Secure message restore is incomplete or incorrect for this account.'
      );
    }

    setKeyMeta(meta);
    setNeedsKeyUnlock(false);

    if (refreshSession) {
      await refreshSession();
    }
  }

  const onUnlock = async () => {
    const passcode =
      unlockPasscode.trim();

    setBusyUnlock(true);
    setUnlockMsg('');
    setResetMsg('');

    try {
      try {
        await unlockKeyBundle(passcode);

        persistUnlockPasscodeForSession(
          passcode
        );

        await validateAndFinishRestore();

        setUnlockPasscode('');
        setUnlockMsg(
          'Secure messages unlocked.'
        );

        return;
      } catch {
        // Continue to pending-key recovery.
      }

      try {
        const promoted =
          await tryPromotePendingLocalPrivateKeyBundle({
            expectedPublicKey:
              serverKey,
            passcode,
          });

        if (promoted) {
          await validateAndFinishRestore();

          setUnlockPasscode('');
          setUnlockMsg(
            'Secure messages restored on this browser.'
          );

          return;
        }
      } catch {
        // Continue to account recovery.
      }

      await restoreRemoteKeyBackupToLocal({
        password: passcode,
      });

      await validateAndFinishRestore();

      setUnlockPasscode('');
      setUnlockMsg(
        'Secure messages restored on this browser.'
      );
    } catch {
      setUnlockMsg(
        'Error: That Secure Messages Passcode did not unlock this browser or its account recovery backup.'
      );
    } finally {
      setBusyUnlock(false);
    }
  };

  const onReset = async () => {
    const passcode =
      resetPasscode.trim();

    if (
      resetConfirm.trim() !==
      'START FRESH'
    ) {
      setResetMsg(
        'Error: Type START FRESH to continue.'
      );
      return;
    }

    const confirmed =
      window.confirm(
        'Start fresh with secure messages?\n\nThis creates a new secure message key for your account. Older app-to-app secure messages may no longer be readable on any device.\n\nSMS/text message conversations are not affected.'
      );

    if (!confirmed) return;

    setBusyReset(true);
    setResetMsg('');

    try {
      const nacl =
        (await import('tweetnacl'))
          .default;

      const naclUtil =
        await import(
          'tweetnacl-util'
        );

      const pair =
        nacl.box.keyPair();

      const publicKey =
        naclUtil.encodeBase64(
          pair.publicKey
        );

      const privateKey =
        naclUtil.encodeBase64(
          pair.secretKey
        );

      await stagePendingLocalPrivateKeyBundle(
        {
          publicKey,
          privateKey,
        },
        passcode
      );

      await axiosClient.post(
        '/auth/keys/rotate',
        {
          publicKey,
          invalidateExistingBackup: true,
        }
      );

      const { data } =
        await axiosClient.get(
          '/auth/me'
        );

      const refreshedUser =
        data?.user ?? data;

      const refreshedPublicKey =
        (
          refreshedUser?.publicKey ||
          ''
        ).trim();

      if (
        refreshedPublicKey !==
        publicKey
      ) {
        throw new Error(
          'The server did not confirm the new secure message key.'
        );
      }

      await promotePendingLocalPrivateKeyBundle({
        expectedPublicKey:
          publicKey,
        passcode,
      });

      setCurrentUser((previous) => ({
        ...previous,
        ...refreshedUser,
      }));

      try {
        const stored =
          localStorage.getItem(
            'user'
          );

        if (stored) {
          localStorage.setItem(
            'user',
            JSON.stringify({
              ...JSON.parse(stored),
              ...refreshedUser,
            })
          );
        }
      } catch {}

      setResetPasscode('');
      setResetConfirm('');

      await validateAndFinishRestore(
        publicKey
      );

      setResetMsg(
        'Fresh secure messages are protected on this browser. Create a new recovery backup.'
      );
    } catch (error) {
      const status =
        error?.response?.status;

      if (
        status &&
        status >= 400 &&
        status < 500
      ) {
        await clearPendingLocalPrivateKeyBundle()
          .catch(() => {});
      }

      const message =
        status === 423
          ? 'Secure message key changes are temporarily unavailable.'
          : error?.message ||
            'Could not start fresh with secure messages.';

      setResetMsg(
        `Error: ${message}`
      );
    } finally {
      setBusyReset(false);
    }
  };

  const unlockDisabled =
    !unlockPasscode ||
    unlockPasscode.trim().length < 6;

  const resetDisabled =
    busyReset ||
    resetPasscode.trim().length < 8 ||
    resetConfirm.trim() !==
      'START FRESH';

  return (
    <Card
      withBorder
      padding="lg"
      radius="md"
    >
      <Stack gap="md">
        <div>
          <Title order={blocked ? 2 : 4}>
            {resolvedTitle}
          </Title>

          <Text c="dimmed" mt={4}>
            {resolvedDescription}
          </Text>
        </div>

        {blocked && (
          <Alert
            color="yellow"
            title="Secure messages locked"
          >
            {authError ||
              'Restore or unlock the secure message key for this browser to continue.'}
          </Alert>
        )}

        <PasswordInput
          label="Secure Messages Passcode"
          value={unlockPasscode}
          onChange={(event) =>
            setUnlockPasscode(
              event.currentTarget.value
            )
          }
          description="Chatforia checks this browser first, then the account recovery backup."
          disabled={busyUnlock}
        />

        <Group justify="flex-end">
          <Button
            onClick={onUnlock}
            loading={busyUnlock}
            disabled={unlockDisabled}
          >
            Unlock secure messages
          </Button>
        </Group>

        {unlockMsg && (
          <Text
            c={
              unlockMsg.startsWith(
                'Error:'
              )
                ? 'red'
                : 'green'
            }
            size="sm"
          >
            {unlockMsg}
          </Text>
        )}

        <Divider />

        <Group justify="center">
          <Button
            variant="subtle"
            size="sm"
            onClick={() =>
              setHelpOpen(
                (value) => !value
              )
            }
          >
            Having trouble unlocking?
          </Button>
        </Group>

        <Collapse in={helpOpen}>
          <Stack gap="xs">
            <Text c="dimmed" size="sm">
              Use the Secure Messages Passcode created when the recovery backup was saved.
            </Text>

            <Text c="dimmed" size="sm">
              A signed-in phone may also approve this browser as a linked device.
            </Text>
          </Stack>
        </Collapse>

        <Divider />

        <Group justify="center">
          <Button
            variant="subtle"
            color="red"
            size="sm"
            onClick={() =>
              setAdvancedOpen(
                (value) => !value
              )
            }
          >
            I cannot recover my secure messages
          </Button>
        </Group>

        <Collapse in={advancedOpen}>
          <Stack gap="sm">
            <Alert
              color="red"
              title="Start fresh with secure messages"
            >
              Only use this as a last resort. Older app-to-app secure messages may no longer be readable on any device. SMS/text conversations are not affected.
            </Alert>

            <PasswordInput
              label="New Secure Messages Passcode"
              value={resetPasscode}
              onChange={(event) =>
                setResetPasscode(
                  event.currentTarget.value
                )
              }
              description="Use at least 8 characters."
              disabled={busyReset}
            />

            <TextInput
              label="Type START FRESH to continue"
              value={resetConfirm}
              onChange={(event) =>
                setResetConfirm(
                  event.currentTarget.value
                )
              }
              disabled={busyReset}
            />

            <Group justify="flex-end">
              <Button
                color="red"
                onClick={onReset}
                loading={busyReset}
                disabled={resetDisabled}
              >
                Start fresh with secure messages
              </Button>
            </Group>

            {resetMsg && (
              <Text
                c={
                  resetMsg.startsWith(
                    'Error:'
                  )
                    ? 'red'
                    : 'green'
                }
                size="sm"
              >
                {resetMsg}
              </Text>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  );
}
