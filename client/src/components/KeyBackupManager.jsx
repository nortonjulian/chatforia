import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  Alert,
  Button,
  Card,
  Divider,
  Group,
  PasswordInput,
  Stack,
  Text,
} from '@mantine/core';

import { useUser } from '@/context/UserContext';

import {
  getLocalKeyBundleMeta,
  getUnlockedPrivateKeyForPublicKey,
} from '@/utils/encryptionClient';

import {
  fetchRemoteKeyBackup,
  restoreRemoteKeyBackupToLocal,
  uploadRemoteKeyBackup,
} from '@/utils/keyBackupRemote';

import {
  createEncryptedKeyBackup,
} from '@/utils/backupClient.js';

function messageColor(message) {
  return message.startsWith('Error:')
    ? 'red'
    : 'green';
}

export default function KeyBackupManager() {
  const {
    currentUser,
    setNeedsKeyUnlock,
    setKeyMeta,
    refreshSession,
  } = useUser();

  const serverKey = useMemo(
    () =>
      typeof currentUser?.publicKey === 'string'
        ? currentUser.publicKey.trim()
        : '',
    [currentUser?.publicKey]
  );

  const [localMeta, setLocalMeta] = useState(null);
  const [hasAccountBackup, setHasAccountBackup] =
    useState(null);

  const [backupMatchesServer, setBackupMatchesServer] =
    useState(true);

  const [checkingStatus, setCheckingStatus] =
    useState(true);

  const [statusError, setStatusError] =
    useState('');

  const [backupPasscode, setBackupPasscode] =
    useState('');

  const [backupConfirm, setBackupConfirm] =
    useState('');

  const [busyBackup, setBusyBackup] =
    useState(false);

  const [backupMessage, setBackupMessage] =
    useState('');

  const [restorePasscode, setRestorePasscode] =
    useState('');

  const [busyRestore, setBusyRestore] =
    useState(false);

  const [restoreMessage, setRestoreMessage] =
    useState('');

  const [filePassword, setFilePassword] =
    useState('');

  const [filePasswordConfirm, setFilePasswordConfirm] =
    useState('');

  const [busyDownload, setBusyDownload] =
    useState(false);

  const [downloadMessage, setDownloadMessage] =
    useState('');

  const localMatchesServer =
    Boolean(
      serverKey &&
      localMeta?.publicKey === serverKey
    );

  const backupActionLabel =
    hasAccountBackup
      ? 'Update Secure Message Backup'
      : 'Create Secure Message Backup';

  async function refreshStatus() {
    setCheckingStatus(true);
    setStatusError('');

    try {
      const [meta, remote] =
        await Promise.all([
          getLocalKeyBundleMeta(),
          fetchRemoteKeyBackup(),
        ]);

      setLocalMeta(meta || null);

      const hasBackup =
        Boolean(
          remote?.encryptedPrivateKeyBundle
        );

      setHasAccountBackup(hasBackup);

      const remotePublicKey =
        typeof remote?.publicKey === 'string'
          ? remote.publicKey.trim()
          : '';

      setBackupMatchesServer(
        !hasBackup ||
          Boolean(
            serverKey &&
            remotePublicKey === serverKey
          )
      );
    } catch (error) {
      setStatusError(
        error?.message ||
          'Could not verify secure message backup status.'
      );
    } finally {
      setCheckingStatus(false);
    }
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  async function getVerifiedPrivateKey() {
    if (!serverKey) {
      throw new Error(
        'This account does not currently expose a secure message key.'
      );
    }

    try {
      return await getUnlockedPrivateKeyForPublicKey(
        serverKey
      );
    } catch (error) {
      if (error?.message === 'LOCKED') {
        throw new Error(
          'This browser is locked. Return to the secure-message recovery screen and unlock it first.'
        );
      }

      throw error;
    }
  }

  async function onSaveAccountBackup() {
    const passcode = backupPasscode.trim();
    const confirm = backupConfirm.trim();

    setBackupMessage('');
    setRestoreMessage('');

    if (passcode.length < 8) {
      setBackupMessage(
        'Error: Secure Messages Passcode must be at least 8 characters.'
      );
      return;
    }

    if (passcode !== confirm) {
      setBackupMessage(
        'Error: Secure Messages Passcodes do not match.'
      );
      return;
    }

    if (!localMatchesServer) {
      setBackupMessage(
        'Error: This browser does not have the verified account secure message key.'
      );
      return;
    }

    setBusyBackup(true);

    try {
      const privateKey =
        await getVerifiedPrivateKey();

      await uploadRemoteKeyBackup({
        publicKey: serverKey,
        privateKey,
        password: passcode,
      });

      const action =
        hasAccountBackup
          ? 'updated'
          : 'created';

      setBackupPasscode('');
      setBackupConfirm('');

      await refreshStatus();

      setBackupMessage(
        `Secure message recovery backup ${action} successfully.`
      );
    } catch (error) {
      setBackupMessage(
        `Error: ${
          error?.message ||
          'Could not save the secure message recovery backup.'
        }`
      );
    } finally {
      setBusyBackup(false);
    }
  }

  async function onRestoreAccountBackup() {
    const passcode =
      restorePasscode.trim();

    setRestoreMessage('');
    setBackupMessage('');

    if (passcode.length < 8) {
      setRestoreMessage(
        'Error: Secure Messages Passcode must be at least 8 characters.'
      );
      return;
    }

    setBusyRestore(true);

    try {
      await restoreRemoteKeyBackupToLocal({
        password: passcode,
      });

      await getUnlockedPrivateKeyForPublicKey(
        serverKey
      );

      const meta =
        await getLocalKeyBundleMeta();

      if (
        !meta?.publicKey ||
        meta.publicKey !== serverKey
      ) {
        throw new Error(
          'The restored key could not be verified for this account.'
        );
      }

      setKeyMeta(meta);
      setNeedsKeyUnlock(false);
      setRestorePasscode('');

      await refreshStatus();

      if (refreshSession) {
        await refreshSession();
      }

      setRestoreMessage(
        'Secure messages restored on this browser.'
      );
    } catch (error) {
      setRestoreMessage(
        `Error: ${
          error?.message ||
          'Could not restore secure messages.'
        }`
      );
    } finally {
      setBusyRestore(false);
    }
  }

  async function onDownloadBackupFile() {
    const password =
      filePassword.trim();

    setDownloadMessage('');

    if (password.length < 8) {
      setDownloadMessage(
        'Error: Backup-file password must be at least 8 characters.'
      );
      return;
    }

    if (
      password !==
      filePasswordConfirm.trim()
    ) {
      setDownloadMessage(
        'Error: Backup-file passwords do not match.'
      );
      return;
    }

    setBusyDownload(true);

    try {
      const privateKey =
        await getVerifiedPrivateKey();

      const { blob, filename } =
        await createEncryptedKeyBackup(
          {
            unlockPasscode:
              'already-unlocked',
            backupPassword: password,
          },
          {
            exportLocalPrivateKeyBundle:
              async () => ({
                publicKey: serverKey,
                privateKey,
              }),
          }
        );

      const url =
        URL.createObjectURL(blob);

      const anchor =
        document.createElement('a');

      anchor.href = url;
      anchor.download = filename;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setTimeout(
        () => URL.revokeObjectURL(url),
        1000
      );

      setFilePassword('');
      setFilePasswordConfirm('');

      setDownloadMessage(
        'Encrypted backup file downloaded.'
      );
    } catch (error) {
      setDownloadMessage(
        `Error: ${
          error?.message ||
          'Could not create the downloadable backup file.'
        }`
      );
    } finally {
      setBusyDownload(false);
    }
  }

  let statusText =
    'Checking secure message status…';

  if (!checkingStatus) {
    if (!serverKey) {
      statusText =
        'No account secure message key is currently registered.';
    } else if (
      localMatchesServer &&
      hasAccountBackup
    ) {
      statusText =
        'Protected on this browser • Recovery backup saved';
    } else if (localMatchesServer) {
      statusText =
        'Protected on this browser • Recovery backup not saved';
    } else {
      statusText =
        'This browser must restore the account secure message key.';
    }
  }

  return (
    <Card
      withBorder
      padding="lg"
      radius="md"
    >
      <Stack gap="md">
        <div>
          <Text fw={700} size="lg">
            Secure Message Recovery
          </Text>

          <Text c="dimmed" size="sm">
            Protect the same account secure message key
            across iPhone, Android, and the web.
          </Text>
        </div>

        <Alert
          color={
            localMatchesServer
              ? 'green'
              : 'yellow'
          }
          title="Secure Message Key"
        >
          {statusText}
        </Alert>

        {statusError && (
          <Text c="red" size="sm">
            Error: {statusError}
          </Text>
        )}

        {hasAccountBackup &&
          !backupMatchesServer && (
            <Alert
              color="red"
              title="Recovery backup mismatch"
            >
              The saved recovery backup does not
              match the current account secure
              message key. Do not restore it.
            </Alert>
          )}

        <Divider
          label={backupActionLabel}
        />

        <Text c="dimmed" size="sm">
          {hasAccountBackup
            ? 'Replace the saved backup or change its Secure Messages Passcode.'
            : 'Create an encrypted account recovery backup using a Secure Messages Passcode.'}
        </Text>

        <PasswordInput
          label="Secure Messages Passcode"
          value={backupPasscode}
          onChange={(event) =>
            setBackupPasscode(
              event.currentTarget.value
            )
          }
          description="Use at least 8 characters. Use this same passcode when restoring on iPhone, Android, or the web."
          disabled={
            busyBackup ||
            checkingStatus
          }
        />

        <PasswordInput
          label="Confirm Secure Messages Passcode"
          value={backupConfirm}
          onChange={(event) =>
            setBackupConfirm(
              event.currentTarget.value
            )
          }
          disabled={
            busyBackup ||
            checkingStatus
          }
        />

        <Group justify="flex-end">
          <Button
            onClick={onSaveAccountBackup}
            loading={busyBackup}
            disabled={
              busyBackup ||
              checkingStatus ||
              !localMatchesServer ||
              backupPasscode.trim().length < 8 ||
              backupConfirm.trim().length < 8
            }
          >
            {backupActionLabel}
          </Button>
        </Group>

        {backupMessage && (
          <Text
            c={messageColor(
              backupMessage
            )}
            size="sm"
          >
            {backupMessage}
          </Text>
        )}

        <Divider label="Restore Secure Messages" />

        <Text c="dimmed" size="sm">
          Restore the account secure message key
          onto this browser using its Secure
          Messages Passcode.
        </Text>

        <PasswordInput
          label="Secure Messages Passcode"
          value={restorePasscode}
          onChange={(event) =>
            setRestorePasscode(
              event.currentTarget.value
            )
          }
          disabled={busyRestore}
        />

        <Group justify="flex-end">
          <Button
            onClick={onRestoreAccountBackup}
            loading={busyRestore}
            disabled={
              busyRestore ||
              hasAccountBackup !== true ||
              !backupMatchesServer ||
              restorePasscode.trim().length < 8
            }
          >
            Restore Secure Messages
          </Button>
        </Group>

        {hasAccountBackup === false && (
          <Text c="dimmed" size="sm">
            No account recovery backup is currently
            saved.
          </Text>
        )}

        {restoreMessage && (
          <Text
            c={messageColor(
              restoreMessage
            )}
            size="sm"
          >
            {restoreMessage}
          </Text>
        )}

        <Accordion>
          <Accordion.Item value="download">
            <Accordion.Control>
              Advanced: Download an encrypted key file
            </Accordion.Control>

            <Accordion.Panel>
              <Stack gap="sm">
                <Alert
                  color="blue"
                  title="Separate backup file"
                >
                  This downloaded file is separate
                  from the account recovery backup
                  used automatically by iPhone,
                  Android, and the web.
                </Alert>

                <PasswordInput
                  label="Backup-file password"
                  value={filePassword}
                  onChange={(event) =>
                    setFilePassword(
                      event.currentTarget.value
                    )
                  }
                  description="Use at least 8 characters."
                  disabled={busyDownload}
                />

                <PasswordInput
                  label="Confirm backup-file password"
                  value={filePasswordConfirm}
                  onChange={(event) =>
                    setFilePasswordConfirm(
                      event.currentTarget.value
                    )
                  }
                  disabled={busyDownload}
                />

                <Group justify="flex-end">
                  <Button
                    variant="light"
                    onClick={onDownloadBackupFile}
                    loading={busyDownload}
                    disabled={
                      busyDownload ||
                      !localMatchesServer ||
                      filePassword.trim().length < 8 ||
                      filePasswordConfirm.trim().length < 8
                    }
                  >
                    Download Encrypted Key File
                  </Button>
                </Group>

                {downloadMessage && (
                  <Text
                    c={messageColor(
                      downloadMessage
                    )}
                    size="sm"
                  >
                    {downloadMessage}
                  </Text>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Card>
  );
}
