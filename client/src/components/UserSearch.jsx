import { useState } from 'react';
import axiosClient from '../api/axiosClient';
import {
  Avatar,
  Paper,
  Title,
  TextInput,
  Button,
  Stack,
  Group,
  Text,
  Loader,
  Alert,
  Divider,
} from '@mantine/core';
import { IconSearch, IconSend } from '@tabler/icons-react';

const UserSearch = ({ currentUser, onNavigateToChatRoom }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) {
      if (query !== '') setQuery('');
      setResults([]);
      setError('');
      setLoading(false);
      return;
    }

    if (q.length < 3) {
      setResults([]);
      setError('Enter at least 3 characters to search people.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await axiosClient.get('/search/people', {
        params: { q, limit: 12 },
      });

      const filtered = (res.data?.items || []).filter(
        (item) =>
          item.kind === 'user' &&
          item.userId &&
          Number(item.userId) !== Number(currentUser.id)
      );
      setResults(filtered);
    } catch (err) {
      console.error('Search error:', err);
      setError(err?.response?.data?.error || 'Unable to fetch users. Please try again');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (userId) => {
    try {
      const res = await axiosClient.post(`/chatrooms/direct/${userId}`);
      const chatroomId = res.data?.id ?? res.data?.chatRoomId ?? res.data?.roomId;
      if (!chatroomId) throw new Error('Missing chat room id');
      onNavigateToChatRoom(chatroomId);
    } catch (err) {
      console.error('Failed to start chat', err);
      setError('Failed to start chat with this user.');
    }
  };

  return (
    <Paper withBorder radius="lg" shadow="sm" p="md" maw={480} mx="auto">
      <Title order={4} mb="sm">Search Users</Title>

      <Group gap="sm" mb="sm">
        <TextInput
          placeholder="Name or username"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => (e.key === 'Enter' ? handleSearch() : undefined)}
          className="flex-1"
          leftSection={<IconSearch size={16} />}
          style={{ flex: 1 }}
        />
        <Button onClick={handleSearch} loading={loading} variant="filled" color="blue">
          Search
        </Button>
      </Group>

      {error && (
        <Alert color="red" variant="light" mb="sm">
          {error}
        </Alert>
      )}

      {!loading && results.length === 0 && query.trim().length >= 3 && !error && (
        <Text size="sm" c="dimmed">No user found</Text>
      )}

      {loading && <Loader size="sm" mt="sm" />}

      <Stack gap="xs" mt="sm">
        {results.map((user, index) => (
          <div key={`user:${user.userId}`}>
            {index > 0 && <Divider my="xs" />}
            <Group justify="space-between" wrap="nowrap">
              <Group wrap="nowrap" style={{ minWidth: 0 }}>
                <Avatar src={user.avatarUrl || undefined} radius="xl">
                  {(user.displayName || user.username || '?').slice(0, 1).toUpperCase()}
                </Avatar>
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate>
                    {user.displayName || user.label || user.username}
                  </Text>
                  <Text size="sm" c="dimmed" truncate>
                    @{user.username}
                  </Text>
                </div>
              </Group>
              <Button
                size="xs"
                color="green"
                leftSection={<IconSend size={14} />}
                onClick={() => handleSendMessage(user.userId)}
              >
                Send
              </Button>
            </Group>
          </div>
        ))}
      </Stack>
    </Paper>
  );
};

export default UserSearch;
