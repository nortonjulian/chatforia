import { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import {
  Table,
  Button,
  Group,
  Title,
  Badge,
  Text,
  Stack,
  Loader,
  Select,
  Textarea,
  Modal,
  Alert,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
// import { toast } from '../utils/toast';

function StatusBadge({ status }) {
  const color =
    status === 'OPEN' ? 'yellow' : status === 'RESOLVED' ? 'green' : 'blue';
  return (
    <Badge color={color} variant="light">
      {status}
    </Badge>
  );
}

export default function AdminReportsPage() {
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [resolveId, setResolveId] = useState(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [err, setErr] = useState('');

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get('/admin/reports', {
        params: { status: statusFilter, take: 50, skip: 0 },
      });
      setItems(res.data.items || []);
      setErr('');
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to load reports';
      setErr(msg);
      toast.err(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const resolveReport = async () => {
    try {
      await axiosClient.patch(`/admin/reports/${resolveId}/resolve`, { notes });
      setNotes('');
      setResolveId(null);
      close();
      toast.ok('Report resolved');
      fetchReports();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to resolve';
      setErr(msg);
      toast.err(msg);
    }
  };

  const warnUser = async (userId) => {
    try {
      await axiosClient.post(`/admin/reports/users/${userId}/warn`, {
        notes: 'Please follow community guidelines.',
      });
      toast.ok('User warned');
      fetchReports();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to warn user';
      setErr(msg);
      toast.err(msg);
    }
  };

  const banUser = async (userId) => {
    if (!confirm('Ban this user?')) return;
    try {
      await axiosClient.post(`/admin/reports/users/${userId}/ban`, {
        reason: 'Abusive content',
      });
      toast.ok('User banned');
      fetchReports();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to ban user';
      setErr(msg);
      toast.err(msg);
    }
  };

  const adminDeleteMessage = async (messageId) => {
    if (!confirm('Delete this message for all?')) return;
    try {
      await axiosClient.delete(`/admin/reports/messages/${messageId}`);
      toast.ok('Message deleted');
      fetchReports();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to delete message';
      setErr(msg);
      toast.err(msg);
    }
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Reports</Title>
        <Group>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            data={[
              { value: 'OPEN', label: 'Open' },
              { value: 'RESOLVED', label: 'Resolved' },
            ]}
          />
          <Button variant="light" onClick={fetchReports}>
            Refresh
          </Button>
        </Group>
      </Group>

      {err && (
        <Alert color="red" variant="light">
          {err}
        </Alert>
      )}

      {loading ? (
        <Loader />
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Status</Table.Th>
              <Table.Th>Reported At</Table.Th>
              <Table.Th>Reporter</Table.Th>
              <Table.Th>Sender</Table.Th>
              <Table.Th>Message (plaintext provided)</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <StatusBadge status={r.status} />
                </Table.Td>
                <Table.Td>{new Date(r.createdAt).toLocaleString()}</Table.Td>
                <Table.Td>
                  {r.reporter?.username} ({r.reporter?.email || 'no email'})
                </Table.Td>
                <Table.Td>
                  {r.message?.sender?.username}
                  {r.message?.sender?.isBanned ? ' • banned' : ''}
                </Table.Td>
                <Table.Td>
                  <Stack gap={4}>
                    <Text size="sm" fw={600}>
                      {r.reason || 'No reason provided'}
                    </Text>

                    <Text size="sm" lineClamp={3}>
                      {r.decryptedContent}
                    </Text>

                    {r.details ? (
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {r.details}
                      </Text>
                    ) : null}

                    {r.blockApplied ? (
                      <Badge size="xs" color="red" variant="light">
                        Blocked after report
                      </Badge>
                    ) : null}
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {r.status === 'OPEN' && (
                      <Button
                        size="xs"
                        onClick={() => {
                          setResolveId(r.id);
                          open();
                        }}
                      >
                        Resolve
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => warnUser(r.message?.sender?.id)}
                    >
                      Warn
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      onClick={() => banUser(r.message?.sender?.id)}
                    >
                      Ban
                    </Button>
                    <Button
                      size="xs"
                      color="orange"
                      variant="light"
                      onClick={() => adminDeleteMessage(r.message?.id)}
                    >
                      Delete Msg
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={opened}
        onClose={close}
        title="Resolve report"
        centered
        radius="lg"
      >
        <Stack>
          <Textarea
            label="Notes (optional)"
            placeholder="What action was taken or why resolved?"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={close}>
              Cancel
            </Button>
            <Button onClick={resolveReport}>Resolve</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
