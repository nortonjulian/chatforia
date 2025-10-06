import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TextInput, Button } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import axiosClient from '@/api/axiosClient';

export default function GlobalPeopleSearch({
  maxWidth = 640,       // adjust to taste
  align = 'left',       // 'left' | 'center'
}) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  const submit = async () => {
    const query = q.trim();
    if (!query) return;
    try {
      const { data } = await axiosClient.get('/search/users', { params: { q: query } });
      const user = Array.isArray(data) ? data[0] : data?.user || null;
      if (user?.id) {
        const { data: room } = await axiosClient.post(`/chatrooms/direct/${user.id}`);
        if (room?.id) { navigate(`/chat/${room.id}`); return; }
      }
      navigate(`/people?q=${encodeURIComponent(query)}`);
    } catch {
      navigate(`/people?q=${encodeURIComponent(query)}`);
    }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') submit(); };

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
      }}
    >
      {/* inner row that enforces the cap and no-grow children */}
      <div
        style={{
          width: '100%',
          maxWidth,                 // hard cap (e.g., 640px)
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'nowrap',
        }}
      >
        <TextInput
          placeholder="Search contacts by alias, name, username, or phone…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          leftSection={<IconSearch size={16} />}
          aria-label="Global people search"
          // fills remaining space but never forces the row wider
          style={{ flex: '1 1 auto', minWidth: 0 }}
        />
        <Button
          onClick={submit}
          aria-label="Search"
          // never grows, fixed sensible width
          style={{ flex: '0 0 auto', width: 120, whiteSpace: 'nowrap' }}
        >
          Search
        </Button>
      </div>
    </div>
  );
}
