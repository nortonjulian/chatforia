import { Card, Text, Stack } from '@mantine/core';

import { useUser } from '@/context/UserContext';

import UsersTable from '../components/admin/UsersTable.jsx';


export default function UsersAdminPage() {
  const { currentUser } = useUser();
  const role = (currentUser?.role || '').toString().toUpperCase();

  if (role !== 'ADMIN') {
    // Only the FIRST line matches the test regex once.
    return (
      <Card withBorder data-testid="card">
        <Stack>
          <Text fw={600}>Forbidden – admin only</Text>
          <Text c="dimmed" size="sm">You don’t have permission to view this page.</Text>
        </Stack>
      </Card>
    );
  }

  return <UsersTable />;
}

export { UsersAdminPage };
