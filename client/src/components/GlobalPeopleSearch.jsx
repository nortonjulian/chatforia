import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TextInput, Button } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import axiosClient from '@/api/axiosClient';
import { toE164 } from '@/utils/phone';
import useDefaultRegion from '@/hooks/useDefaultRegion';

export default function GlobalPeopleSearch({ maxWidth = 640, align = 'left' }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const defaultRegion = useDefaultRegion({ userCountryCode: undefined });

  const submit = async () => {
    const query = q.trim();
    if (!query) return;

    try {
      const { data } = await axiosClient.get('/search/people', { params: { q: query, limit: 8 } });
      const items = data?.items || [];

      if (items.length) {
        const top = items[0];
        if (top.kind === 'sms_thread') {
          return navigate(`/texts/${top.id}`);
        }
        if (top.kind === 'contact' && top.phone) {
          const { data: thr } = await axiosClient.post('/sms/threads', { to: top.phone });
          if (thr?.id) return navigate(`/texts/${thr.id}`);
        }
        if (top.kind === 'user' && top.userId) {
          const { data: room } = await axiosClient.post(`/chatrooms/direct/${top.userId}`);
          if (room?.id) return navigate(`/chat/${room.id}`);
        }
      }

      // If user typed a raw number and nothing matched, start a new thread
      const e164 = toE164(query, defaultRegion);
      if (e164) {
        const { data: thr } = await axiosClient.post('/sms/threads', { to: e164 });
        if (thr?.id) return navigate(`/texts/${thr.id}`);
      }

      // Fallback to results page
      navigate(`/people?q=${encodeURIComponent(query)}`);
    } catch {
      navigate(`/people?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
      <div style={{ width: '100%', maxWidth, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'nowrap' }}>
        <TextInput
          placeholder="Search contacts, users, or numbers…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => (e.key === 'Enter' ? submit() : undefined)}
          leftSection={<IconSearch size={16} />}
          aria-label="Global people search"
          style={{ flex: '1 1 auto', minWidth: 0 }}
        />
        <Button onClick={submit} aria-label="Search" style={{ flex: '0 0 auto', width: 120 }}>
          Search
        </Button>
      </div>
    </div>
  );
}
