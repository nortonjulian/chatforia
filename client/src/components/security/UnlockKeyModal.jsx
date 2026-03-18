import { useEffect, useState } from 'react';
import { Modal, Stack, Text, PasswordInput, Button, Alert } from '@mantine/core';
import { useUser } from '@/context/UserContext';
import { unlockKeyBundle } from '@/utils/encryptionClient';

export default function UnlockKeyModal() {
  const { currentUser, needsKeyUnlock, setNeedsKeyUnlock } = useUser();

  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!needsKeyUnlock) {
      setPasscode('');
      setError('');
      setLoading(false);
    }
  }, [needsKeyUnlock]);

  const handleUnlock = async () => {
    if (!passcode.trim()) {
      setError('Enter your passcode.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await unlockKeyBundle(passcode);
      setNeedsKeyUnlock(false);

      // Reload so messages decrypt correctly
      window.location.reload();
    } catch (err) {
      console.error('[E2EE] unlock failed', err);
      setError('Incorrect passcode or unable to unlock your private key.');
    } finally {
      setLoading(false);
    }
  };

  if (!currentUser) return null;

  return (
    <Modal
      opened={needsKeyUnlock}
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      centered
      title="Unlock Private Key"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Encrypted messages on this device are locked. Enter your passcode to unlock your private key.
        </Text>

        {error && (
          <Alert color="red">
            {error}
          </Alert>
        )}

        <PasswordInput
          label="Passcode"
          placeholder="Enter your key passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) {
              handleUnlock();
            }
          }}
          autoFocus
        />

        <Button loading={loading} onClick={handleUnlock}>
          Unlock
        </Button>
      </Stack>
    </Modal>
  );
}