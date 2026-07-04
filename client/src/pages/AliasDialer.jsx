import { useState } from 'react';
import { Button, Group, TextInput } from '@mantine/core';
import api from '@/api/axiosClient';

function AliasDialer() {
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);

  const call = async () => {
    if (!to) return;

    setLoading(true);

    try {
      const { data: started } = await api.post('/calls/start-external', {
        phoneNumber: to,
        mode: 'AUDIO',
      });

      const callId =
        started?.resolvedCallId ||
        started?.callId ||
        started?.call?.id ||
        null;

      const body = { to };

      if (callId) {
        body.callId = callId;
      }

      await api.post('/voice/call', body);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Group mt="md">
      <TextInput
        label="Call (E.164)"
        placeholder="+15551234567"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <Button onClick={call} disabled={!to || loading} loading={loading}>
        Place Call (alias)
      </Button>
    </Group>
  );
}

export default AliasDialer;