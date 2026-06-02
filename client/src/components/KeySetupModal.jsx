import { useRef, useState } from 'react';
import {
  Modal,
  Stack,
  Text,
  Group,
  Button,
  FileInput,
  PasswordInput,
  Alert,
  Divider,
  Collapse,
} from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { generateKeypair, saveKeysLocal, loadKeysLocal } from '../utils/keys';
import { importEncryptedPrivateKey } from '../utils/keyBackup';
import {
  uploadRemoteKeyBackup,
  restoreRemoteKeyBackupToLocal,
} from '../utils/keyBackupRemote';
import { useTranslation } from 'react-i18next';

export default function KeySetupModal({ opened, onClose, haveServerPubKey }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);

  const [recoveryPasscode, setRecoveryPasscode] = useState('');
  const [confirmRecoveryPasscode, setConfirmRecoveryPasscode] = useState('');
  const [filePassword, setFilePassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const resetForm = () => {
    setRecoveryPasscode('');
    setConfirmRecoveryPasscode('');
    setFilePassword('');
    setMsg('');
    setErr('');
    setShowAdvanced(false);

    if (fileRef.current) {
      fileRef.current.value = null;
    }
  };

  const finish = () => {
    resetForm();
    onClose?.();
  };

  const validateRecoveryPasscode = ({ requireConfirm = false } = {}) => {
    const passcode = recoveryPasscode.trim();
    const confirm = confirmRecoveryPasscode.trim();

    if (passcode.length < 8) {
      return 'Recovery Passcode must be at least 8 characters.';
    }

    if (requireConfirm && passcode !== confirm) {
      return 'Recovery Passcodes do not match.';
    }

    return null;
  };

  const handleSetupEncryption = async () => {
    try {
      setErr('');
      setMsg('');

      const validationError = validateRecoveryPasscode({
        requireConfirm: true,
      });

      if (validationError) {
        setErr(validationError);
        return;
      }

      setBusy(true);

      const kp = generateKeypair();

      await saveKeysLocal(kp);

      await axiosClient.post('/users/keys', {
        publicKey: kp.publicKey,
      });

      await uploadRemoteKeyBackup({
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
        password: recoveryPasscode.trim(),
      });

      setMsg(
        t(
          'keySetup.encryptionReady',
          'Encryption is ready. Your Recovery Passcode can restore chats on your other devices.'
        )
      );

      setTimeout(finish, 800);
    } catch (e) {
      console.error(e);
      setErr(
        e?.message ||
          t(
            'keySetup.setupFailed',
            'Failed to set up encryption. Please try again.'
          )
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFromAccount = async () => {
    try {
      setErr('');
      setMsg('');

      const validationError = validateRecoveryPasscode();

      if (validationError) {
        setErr(validationError);
        return;
      }

      setBusy(true);

      await restoreRemoteKeyBackupToLocal({
        password: recoveryPasscode.trim(),
      });

      setMsg(
        t(
          'keySetup.restored',
          'Encrypted chats restored on this device.'
        )
      );

      setTimeout(finish, 800);
    } catch (e) {
      console.error(e);
      setErr(
        e?.message ||
          t(
            'keySetup.restoreFailed',
            'Could not restore your encrypted chats. Check your Recovery Passcode and try again.'
          )
      );
    } finally {
      setBusy(false);
    }
  };

  const handleImportFileBackup = async (file) => {
    try {
      setErr('');
      setMsg('');

      if (!file || !filePassword) {
        setErr(
          t(
            'keySetup.chooseFile',
            'Choose a backup file and enter its password.'
          )
        );
        return;
      }

      setBusy(true);

      const privateKeyB64 = await importEncryptedPrivateKey(
        file,
        filePassword
      );

      const existing = await loadKeysLocal();

      await saveKeysLocal({
        publicKey: existing?.publicKey || null,
        privateKey: privateKeyB64,
      });

      setMsg(
        t(
          'keySetup.imported',
          'Private key imported to this device.'
        )
      );

      setTimeout(finish, 800);
    } catch (e) {
      console.error(e);
      setErr(
        t(
          'keySetup.importFailed',
          'Import failed. Wrong password or invalid backup file.'
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const isExistingAccount = Boolean(haveServerPubKey);

  const primaryDisabled = isExistingAccount
    ? recoveryPasscode.trim().length < 8
    : recoveryPasscode.trim().length < 8 ||
      confirmRecoveryPasscode.trim().length < 8;

  return (
    <Modal
      opened={opened}
      onClose={finish}
      title={
        isExistingAccount
          ? t('keySetup.restoreTitle', 'Restore encrypted chats')
          : t('keySetup.setupTitle', 'Secure your encrypted chats')
      }
      radius="lg"
      centered
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {isExistingAccount
            ? t(
                'keySetup.restoreDescription',
                'This device does not have your encryption key yet. Enter your Recovery Passcode to restore your encrypted chats.'
              )
            : t(
                'keySetup.setupDescription',
                'Create one Recovery Passcode. It protects your encrypted chat backup and lets you restore chats on your other devices.'
              )}
        </Text>

        <Alert variant="light" color={isExistingAccount ? 'blue' : 'green'}>
          {isExistingAccount
            ? t(
                'keySetup.serverKeyFound',
                'We found encryption already set up for your account.'
              )
            : t(
                'keySetup.newEncryptionBackup',
                'Your key will be saved on this device and backed up securely for cross-device recovery.'
              )}
        </Alert>

        <PasswordInput
          label={t('keySetup.recoveryPasscode', 'Recovery Passcode')}
          placeholder={t(
            'keySetup.recoveryPasscodePlaceholder',
            'Enter your Recovery Passcode'
          )}
          value={recoveryPasscode}
          onChange={(e) => setRecoveryPasscode(e.currentTarget.value)}
          description={t(
            'keySetup.recoveryPasscodeDescription',
            'Use at least 8 characters. Chatforia cannot recover this for you.'
          )}
          disabled={busy}
        />

        {!isExistingAccount && (
          <PasswordInput
            label={t(
              'keySetup.confirmRecoveryPasscode',
              'Confirm Recovery Passcode'
            )}
            placeholder={t(
              'keySetup.confirmRecoveryPasscodePlaceholder',
              'Re-enter your Recovery Passcode'
            )}
            value={confirmRecoveryPasscode}
            onChange={(e) =>
              setConfirmRecoveryPasscode(e.currentTarget.value)
            }
            disabled={busy}
          />
        )}

        <Button
          fullWidth
          loading={busy}
          disabled={busy || primaryDisabled}
          onClick={
            isExistingAccount
              ? handleRestoreFromAccount
              : handleSetupEncryption
          }
        >
          {isExistingAccount
            ? t('keySetup.restoreChats', 'Restore Chats')
            : t('keySetup.setupEncryption', 'Set Up Encryption')}
        </Button>

        <Divider label={t('common.advanced', 'Advanced')} />

        <Button
          variant="subtle"
          onClick={() => setShowAdvanced((value) => !value)}
          disabled={busy}
        >
          {showAdvanced
            ? t('keySetup.hideAdvanced', 'Hide advanced recovery')
            : t('keySetup.showAdvanced', 'Show advanced recovery')}
        </Button>

        <Collapse in={showAdvanced}>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {t(
                'keySetup.advancedDescription',
                'Use this only if you have an older downloaded key backup file.'
              )}
            </Text>

            <FileInput
              ref={fileRef}
              accept="application/json"
              label={t('keySetup.backupFile', 'Backup file')}
              placeholder={t(
                'keySetup.selectBackupFile',
                'Select backup file'
              )}
              disabled={busy}
            />

            <PasswordInput
              label={t('keySetup.fileBackupPassword', 'Backup file password')}
              placeholder={t(
                'keySetup.fileBackupPasswordPlaceholder',
                'Enter backup file password'
              )}
              value={filePassword}
              onChange={(e) => setFilePassword(e.currentTarget.value)}
              disabled={busy}
            />

            <Group justify="flex-end">
              <Button
                variant="light"
                loading={busy}
                disabled={busy || !filePassword}
                onClick={() =>
                  handleImportFileBackup(fileRef.current?.files?.[0])
                }
              >
                {t('keySetup.importBackupFile', 'Import Backup File')}
              </Button>
            </Group>
          </Stack>
        </Collapse>

        {msg && (
          <Alert color="green" variant="light">
            {msg}
          </Alert>
        )}

        {err && (
          <Alert color="red" variant="light">
            {err}
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}