import { useState } from 'react';
import axiosClient from '../api/axiosClient';
import {
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
      // Clear whitespace-only input so UI doesn't show "No user found"
      if (query !== '') setQuery('');
      setResults([]);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await axiosClient.get(`/users/search?query=${encodeURIComponent(q)}`);
      const filtered = (res.data || []).filter((user) => user.id !== currentUser.id);
      setResults(filtered);
    } catch (err) {
      console.error('Search error:', err);
      setError('Unable to fetch users. Please try again');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (userId) => {
    try {
      const res = await axiosClient.post('/chatrooms/direct', {
        userId1: currentUser.id,
        userId2: userId,
      });
      const chatroomId = res.data;
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
          placeholder="Username or phone number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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

      {!loading && results.length === 0 && query && !error && (
        <Text size="sm" c="dimmed">No user found</Text>
      )}

      {loading && <Loader size="sm" mt="sm" />}

      <Stack gap="xs" mt="sm">
        {results.map((user, index) => (
          <div key={user.id}>
            {index > 0 && <Divider my="xs" />}
            <Group justify="space-between">
              <div>
                <Text fw={500}>{user.username}</Text>
                {user.phoneNumber && (
                  <Text size="sm" c="dimmed">{user.phoneNumber}</Text>
                )}
              </div>
              <Button
                size="xs"
                color="green"
                leftSection={<IconSend size={14} />}
                onClick={() => handleSendMessage(user.id)}
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
