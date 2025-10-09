import { useEffect, useState } from 'react';
import { Modal, Text, TextInput, Group, Button } from '@mantine/core';

export default function TwoFADisableModal({ opened, onClose }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!opened) setCode(''); }, [opened]);

  const disable = async () => {
    setLoading(true);
    try {
      const r = await fetch('/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const j = await r.json();
      if (j.ok) onClose?.(true);
      else alert(j.reason || j.error || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={() => onClose?.(false)} title="Disable 2FA" centered>
      <Text size="sm" c="dimmed" mb="xs">
        Enter a current code from your authenticator app to confirm disabling 2FA.
      </Text>
      <TextInput
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.currentTarget.value)}
        maxLength={6}
        inputMode="numeric"
      />
      <Group justify="end" mt="md">
        <Button variant="outline" color="red" loading={loading} onClick={disable}>
          Disable 2FA
        </Button>
      </Group>
    </Modal>
  );
}
