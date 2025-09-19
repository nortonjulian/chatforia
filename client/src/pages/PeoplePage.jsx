import { useEffect, useState } from 'react';
import { Title, Group, Button, Paper, TextInput, ActionIcon } from '@mantine/core';
import { IconSearch, IconX } from '@tabler/icons-react';
import { useUser } from '../context/UserContext';
import StartChatModal from '../components/StartChatModal';
import ContactList from '../components/ContactList';
import ImportContactsModal from '@/components/contacts/ImportContactsModal';

export default function PeoplePage() {
  const { currentUser } = useUser();
  const [openStartChat, setOpenStartChat] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const [q, setQ] = useState('');
  const [input, setInput] = useState('');

  useEffect(() => {
    // Optional: preload from URL ?q=
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('q') || '';
    if (initial) {
      setInput(initial);
      setQ(initial);
    }
  }, []);

  if (!currentUser) return null;

  const applySearch = () => {
    const next = input.trim();
    setQ(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('q', next);
    else url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
  };

  const clearSearch = () => {
    setInput('');
    setQ('');
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
  };

  return (
    <div>
      <Group justify="space-between" mb="sm">
        <Title order={4}>People</Title>
        <Group gap="xs">
          <Button variant="light" onClick={() => setOpenImport(true)}>Import contacts</Button>
          <Button onClick={() => setOpenStartChat(true)}>Find / Add Contact</Button>
        </Group>
      </Group>

      <Group mb="sm" align="center" grow>
        <TextInput
          placeholder="Search contacts by alias, name, username, or phone…"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          leftSection={<IconSearch size={16} />}
          rightSection={
            input ? (
              <ActionIcon aria-label="Clear search" onClick={clearSearch} variant="subtle">
                <IconX size={16} />
              </ActionIcon>
            ) : null
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') applySearch();
          }}
        />
        <Button onClick={applySearch}>Search</Button>
      </Group>

      <Paper withBorder radius="xl" p="md">
        {/* Pass search query to ContactList; it should call GET /contacts?q=<q>&limit=... */}
        <ContactList currentUserId={currentUser.id} searchQuery={q} />
      </Paper>

      {openStartChat && (
        <StartChatModal
          currentUserId={currentUser.id}
          onClose={() => setOpenStartChat(false)}
        />
      )}

      <ImportContactsModal
        opened={openImport}
        onClose={() => setOpenImport(false)}
        defaultCountry="US"
      />
    </div>
  );
}
