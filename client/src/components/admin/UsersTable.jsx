import { Card, Text, Stack, Group, Button, Divider } from '@mantine/core';
import { useEffect, useState } from 'react';

import api from '../../api/axiosClient';

import UserDetailsDialog from './UserDetailsDialog.jsx';

// Accept several common shapes: { users: [...] }, { items: [...] }, raw [...]
function normalizeUsers(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (payload.data) return normalizeUsers(payload.data);
  return [];
}

export default function UsersTable() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/admin/users');
        if (!alive) return;
        setUsers(normalizeUsers(data));
        setLoadError('');
      } catch (error) {
        if (alive) {
          setUsers([]);
          const status = error?.response?.status;
          setLoadError(
            status === 401 || status === 403
              ? 'Your session is not authorized to view users. Please sign in again with administrator MFA.'
              : 'Unable to load users. Please try again later.'
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card withBorder data-testid="card">
      {selected && (
        <UserDetailsDialog
          userId={selected.id}
          mode={selected.mode}
          onClose={() => setSelected(null)}
          onSaved={(updated) =>
            setUsers((current) =>
              current.map((user) =>
                user.id === updated.id ? { ...user, ...updated } : user
              )
            )
          }
        />
      )}
      <Stack gap="sm">
        <Text fw={600}>Users</Text>
        {loading ? (
          <Text c="dimmed" size="sm">
            Loading…
          </Text>
        ) : loadError ? (
          <Text c="red" size="sm" role="alert">
            {loadError}
          </Text>
        ) : users.length === 0 ? (
          <Text c="dimmed" size="sm">
            No users found.
          </Text>
        ) : (
          <Stack gap={4}>
            {users.map((user, idx) => (
              <div key={user.id ?? idx} data-user-id={user.id}>
                {idx > 0 && <Divider my={4} />}
                <Group
                  justify="space-between"
                  wrap="nowrap"
                  role="group"
                  aria-label={`User ${user.id}`}
                >
                  <div>
                    <Text>{user.username ?? `User #${user.id}`}</Text>
                    {user.displayName && (
                      <Text size="sm">{user.displayName}</Text>
                    )}
                    {user.role ? (
                      <Text size="xs" c="dimmed">
                        {String(user.role).toUpperCase()}
                      </Text>
                    ) : null}
                  </div>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => setSelected({ id: user.id, mode: 'view' })}
                    >
                      View
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => setSelected({ id: user.id, mode: 'edit' })}
                    >
                      Edit
                    </Button>
                  </Group>
                </Group>
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
