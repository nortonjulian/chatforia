import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  Alert,
  Button,
  Card,
  Group,
  Stack,
  Text,
} from '@mantine/core';

import {
  IconRefresh,
  IconShieldLock,
} from '@tabler/icons-react';

import { useNavigate } from 'react-router-dom';
import { useUser } from '@/context/UserContext';

import {
  getLocalKeyBundleMeta,
} from '@/utils/encryptionClient';

import {
  fetchRemoteKeyBackup,
} from '@/utils/keyBackupRemote';

export default function SecureMessageSettingsCard() {
  const navigate = useNavigate();

  const {
    currentUser,
    needsKeyUnlock,
  } = useUser();

  const serverKey =
    typeof currentUser?.publicKey === 'string'
      ? currentUser.publicKey.trim()
      : '';

  const [status, setStatus] = useState({
    checking: true,
    localMeta: null,
    hasBackup: false,
    backupMatchesServer: true,
    error: '',
  });

  const refreshStatus = useCallback(async () => {
    setStatus((previous) => ({
      ...previous,
      checking: true,
      error: '',
    }));

    if (!serverKey) {
      setStatus({
        checking: false,
        localMeta: null,
        hasBackup: false,
        backupMatchesServer: true,
        error: '',
      });

      return;
    }

    try {
      const [localMeta, remoteBackup] =
        await Promise.all([
          getLocalKeyBundleMeta(),
          fetchRemoteKeyBackup(),
        ]);

      const hasBackup =
        Boolean(
          remoteBackup?.encryptedPrivateKeyBundle
        );

      const remotePublicKey =
        typeof remoteBackup?.publicKey === 'string'
          ? remoteBackup.publicKey.trim()
          : '';

      setStatus({
        checking: false,
        localMeta: localMeta || null,
        hasBackup,
        backupMatchesServer:
          !hasBackup ||
          remotePublicKey === serverKey,
        error: '',
      });
    } catch (error) {
      setStatus({
        checking: false,
        localMeta: null,
        hasBackup: false,
        backupMatchesServer: true,
        error:
          error?.message ||
          'Could not verify secure message recovery status.',
      });
    }
  }, [serverKey]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const localMatchesServer =
    Boolean(
      serverKey &&
      status.localMeta?.publicKey === serverKey
    );

  const requiresRestore =
    Boolean(
      serverKey &&
      (
        needsKeyUnlock ||
        !localMatchesServer
      )
    );

  let alertColor = 'blue';
  let statusText =
    'Checking secure message status…';

  if (!status.checking) {
    if (status.error) {
      alertColor = 'red';
      statusText =
        'Secure message status could not be verified.';
    } else if (!serverKey) {
      alertColor = 'yellow';
      statusText =
        'No account secure message key is currently registered.';
    } else if (
      !status.backupMatchesServer
    ) {
      alertColor = 'red';
      statusText =
        'The saved recovery backup does not match the account secure message key.';
    } else if (requiresRestore) {
      alertColor = 'yellow';
      statusText =
        'This browser must restore the account secure message key.';
    } else if (status.hasBackup) {
      alertColor = 'green';
      statusText =
        'Protected on this browser • Recovery backup saved';
    } else {
      alertColor = 'yellow';
      statusText =
        'Protected on this browser • Recovery backup not saved';
    }
  }

  let actionLabel =
    'Manage Secure Message Recovery';

  if (requiresRestore) {
    actionLabel =
      'Restore Secure Messages';
  } else if (status.hasBackup) {
    actionLabel =
      'Update Secure Message Backup';
  } else if (serverKey) {
    actionLabel =
      'Create Secure Message Backup';
  }

  return (
    <Card
      withBorder
      padding="lg"
      radius="md"
    >
      <Stack gap="md">
        <Group
          justify="space-between"
          align="flex-start"
          wrap="nowrap"
        >
          <Group
            align="flex-start"
            wrap="nowrap"
          >
            <IconShieldLock
              size={24}
              aria-hidden="true"
            />

            <div>
              <Text fw={700}>
                Secure Message Key
              </Text>

              <Text
                c="dimmed"
                size="sm"
              >
                Manage encrypted-message recovery
                across iPhone, Android, and the web.
              </Text>
            </div>
          </Group>

          <Button
            variant="subtle"
            size="compact-sm"
            aria-label="Refresh secure message status"
            onClick={refreshStatus}
            loading={status.checking}
            leftSection={
              <IconRefresh size={16} />
            }
          >
            Refresh
          </Button>
        </Group>

        <Alert
          color={alertColor}
          title="Secure Message Key"
        >
          {statusText}
        </Alert>

        {status.error && (
          <Text
            c="red"
            size="sm"
          >
            Error: {status.error}
          </Text>
        )}

        <Group justify="flex-end">
          <Button
            onClick={() =>
              navigate('/settings/security')
            }
            disabled={
              status.checking ||
              !serverKey
            }
          >
            {actionLabel}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
