import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Code,
  Image,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';

import {
  setupTwoFactor,
  enableTwoFactor,
} from '@/api/twoFactor';

export default function TwoFASetupModal({ opened, onClose }) {
  const [qr, setQr] = useState(null);
  const [tmpSecret, setTmpSecret] = useState(null);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const completed = backup.length > 0;

  useEffect(() => {
    if (!opened) return;

    let active = true;

    setQr(null);
    setTmpSecret(null);
    setCode('');
    setBackup([]);
    setAcknowledged(false);
    setError('');
    setBusy(true);

    setupTwoFactor()
      .then((result) => {
        if (!active) return;
        setQr(result.qrDataUrl);
        setTmpSecret(result.tmpSecret);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err?.response?.data?.error ||
          err?.message ||
          'Could not start two-factor authentication setup.'
        );
      })
      .finally(() => {
        if (active) setBusy(false);
      });

    return () => {
      active = false;
    };
  }, [opened]);

  const close = () => {
    if (busy || (completed && !acknowledged)) return;
    onClose?.(completed);
  };

  const enable = async () => {
    if (busy || !tmpSecret || !/^\d{6}$/.test(code)) return;

    setBusy(true);
    setError('');

    try {
      const result = await enableTwoFactor(tmpSecret, code);
      setBackup(result.backupCodes);
      setQr(null);
      setTmpSecret(null);
      setCode('');
    } catch (err) {
      setError(
        err?.response?.data?.error ||
        err?.response?.data?.reason ||
        err?.message ||
        'Could not enable two-factor authentication.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Enable two-factor authentication"
      centered
      closeOnEscape={!busy && (!completed || acknowledged)}
      closeOnClickOutside={!busy && (!completed || acknowledged)}
    >
      <Stack gap="md">
        {!completed ? (
          <>
            <Text size="sm">
              Scan the QR code with your authenticator app,
              then enter its six-digit verification code.
            </Text>

            {qr && (
              <Image
                src={qr}
                alt="Authenticator setup QR code"
                w={220}
              />
            )}

            <TextInput
              label="Authenticator code"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={busy || !tmpSecret}
            />

            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}

            <Button
              onClick={enable}
              loading={busy}
              disabled={busy || !tmpSecret || !/^\d{6}$/.test(code)}
            >
              Enable 2FA
            </Button>
          </>
        ) : (
          <>
            <Alert color="green" title="Two-factor authentication enabled">
              Save these recovery codes now. They will not be shown again.
            </Alert>

            <Stack gap={4}>
              {backup.map((value) => (
                <Code key={value}>{value}</Code>
              ))}
            </Stack>

            <Checkbox
              label="I have saved my recovery codes in a safe place"
              checked={acknowledged}
              onChange={(event) =>
                setAcknowledged(event.currentTarget.checked)
              }
            />

            <Button
              disabled={!acknowledged}
              onClick={close}
            >
              Done
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
