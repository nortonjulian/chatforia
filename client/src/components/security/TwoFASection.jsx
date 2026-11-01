import { useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';

import TwoFASetupModal from '@/components/auth/TwoFASetupModal.jsx';
import { disableTwoFactor } from '@/api/twoFactor';

export default function TwoFASection({ user, onChange }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableError, setDisableError] = useState('');

  const enabled = user?.twoFactorEnabled === true;

  const closeSetup = async (completed = false) => {
    setSetupOpen(false);
    if (completed) {
      await onChange?.();
    }
  };

  const closeDisable = () => {
    if (disableBusy) return;
    setDisableOpen(false);
    setDisableCode('');
    setDisableError('');
  };

  const submitDisable = async () => {
    if (disableBusy) return;

    setDisableBusy(true);
    setDisableError('');

    try {
      await disableTwoFactor(disableCode);
      setDisableOpen(false);
      setDisableCode('');
      await onChange?.();
    } catch (error) {
      setDisableError(
        error?.response?.data?.error ||
        error?.message ||
        'Could not disable two-factor authentication.'
      );
    } finally {
      setDisableBusy(false);
    }
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Text fw={600}>Two-factor authentication</Text>
          <Text size="sm" c="dimmed">
            Protect your account using an authenticator app.
          </Text>
        </Stack>

        <Badge color={enabled ? 'green' : 'gray'}>
          {enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </Group>

      {enabled ? (
        <Button
          variant="light"
          color="red"
          onClick={() => setDisableOpen(true)}
        >
          Disable two-factor authentication
        </Button>
      ) : (
        <Button onClick={() => setSetupOpen(true)}>
          Enable two-factor authentication
        </Button>
      )}

      <TwoFASetupModal
        opened={setupOpen}
        onClose={closeSetup}
      />

      <Modal
        opened={disableOpen}
        onClose={closeDisable}
        title="Disable two-factor authentication"
        centered
        closeOnEscape={!disableBusy}
        closeOnClickOutside={!disableBusy}
      >
        <Stack gap="md">
          <Text size="sm">
            Enter your current authenticator code to disable
            two-factor authentication.
          </Text>

          <TextInput
            label="Authenticator code"
            value={disableCode}
            onChange={(event) =>
              setDisableCode(event.currentTarget.value)
            }
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
          />

          {disableError && (
            <Text size="sm" c="red" role="alert">
              {disableError}
            </Text>
          )}

          <Group justify="flex-end">
            <Button
              variant="light"
              onClick={closeDisable}
              disabled={disableBusy}
            >
              Cancel
            </Button>

            <Button
              color="red"
              loading={disableBusy}
              disabled={disableBusy || !/^\d{6}$/.test(disableCode)}
              onClick={submitDisable}
            >
              Disable 2FA
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
