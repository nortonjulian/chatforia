import { useEffect, useState } from 'react';
import { Button, Group, Stack, TextInput, Title } from '@mantine/core';
import api from '@/api/axiosClient';
import { Link } from 'react-router-dom';

import AliasDialer from '@/pages/AliasDialer.jsx';

export default function SmsThreads() {
  const [items, setItems] = useState([]);
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    api.get('/sms/threads').then(({ data }) => setItems(data.items || [])).catch(()=>{});
  }, []);

  const sendQuick = async () => {
    await api.post('/sms/send', { to, body });
    setBody('');
  };

  return (
    <Stack>
      <Title order={3}>Text Messages (Chatforia number)</Title>
      <Group align="end">
        <TextInput label="To (E.164)" placeholder="+15551234567" value={to} onChange={(e)=>setTo(e.target.value)} />
        <TextInput label="Message" placeholder="Type a message…" value={body} onChange={(e)=>setBody(e.target.value)} />
        <Button onClick={sendQuick} disabled={!to || !body.trim()}>Send</Button>
      </Group>
      <Stack>
        {items.map(t => (
          <Link key={t.id} to={`/sms/${t.id}`}>{t.displayName || t.contactPhone || `SMS #${t.id}`}</Link>
        ))}
      </Stack>
      <AliasDialer />
    </Stack>
  );
}
