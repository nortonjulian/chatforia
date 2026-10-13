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

    // Phone numbers remain unambiguous and can go directly to SMS.
    const e164 = toE164(query, defaultRegion);
    if (e164) {
      try {
        const { data: thr } = await axiosClient.post('/sms/threads', { to: e164 });
        if (thr?.id) return navigate(`/texts/${thr.id}`);
      } catch {
        // Fall through to the results page instead of guessing.
      }
    }

    // Names/usernames must always go through an explicit result-selection step.
    navigate(`/people?q=${encodeURIComponent(query)}`);
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
