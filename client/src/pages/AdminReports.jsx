import { useEffect, useMemo, useState } from 'react';
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
  Card,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
// Uncomment if you already have this utility in the project:
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

function safeToast(type, message) {
  // Replace with your real toast util if present.
  if (type === 'error') {
    console.error(message);
  } else {
    console.log(message);
  }
}

function getMessagePreview(report) {
  return (
    report?.decryptedContent ||
    report?.message?.rawContent ||
    report?.message?.translatedContent ||
    '[No plaintext available]'
  );
}

export default function AdminReportsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
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
      setTotal(res.data.total || 0);
      setErr('');
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to load reports';
      setErr(msg);
      safeToast('error', msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const openCountLabel = useMemo(() => {
    if (loading) return 'Loading...';
    return `${total} report${total === 1 ? '' : 's'}`;
  }, [loading, total]);

  const resolveReport = async () => {
    if (!resolveId) return;

    try {
      await axiosClient.patch(`/admin/reports/${resolveId}/resolve`, { notes });

      setNotes('');
      setResolveId(null);
      close();
      safeToast('success', 'Report resolved');
      fetchReports();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to resolve';
      setErr(msg);
      safeToast('error', msg);
    }
  };

  const warnUser = async (userId) => {
    if (!userId) return;

    try {
      await axiosClient.post(`/admin/reports/users/${userId}/warn`, {
        notes: 'Please follow community guidelines.',
      });

      safeToast('success', 'User warned');
      fetchReports();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to warn user';
      setErr(msg);
      safeToast('error', msg);
    }
  };

  const banUser = async (userId) => {
    if (!userId) return;
    if (!window.confirm('Ban this user?')) return;

    try {
      await axiosClient.post(`/admin/reports/users/${userId}/ban`, {
        reason: 'Abusive content',
      });

      safeToast('success', 'User banned');
      fetchReports();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to ban user';
      setErr(msg);
      safeToast('error', msg);
    }
  };

  const adminDeleteMessage = async (messageId) => {
    if (!messageId) return;
    if (!window.confirm('Delete this message for all?')) return;

    try {
      await axiosClient.delete(`/admin/reports/messages/${messageId}`);

      safeToast('success', 'Message deleted');
      fetchReports();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to delete message';
      setErr(msg);
      safeToast('error', msg);
    }
  };

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={3}>Reports</Title>
          <Text size="sm" c="dimmed">
            {openCountLabel}
          </Text>
        </div>

        <Group>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value || 'OPEN')}
            data={[
              { value: 'OPEN', label: 'Open' },
              { value: 'RESOLVED', label: 'Resolved' },
            ]}
            allowDeselect={false}
            w={180}
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
      ) : items.length === 0 ? (
        <Card withBorder radius="lg" p="lg">
          <Text>No reports found.</Text>
        </Card>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Status</Table.Th>
              <Table.Th>Reported At</Table.Th>
              <Table.Th>Reporter</Table.Th>
              <Table.Th>Reported User</Table.Th>
              <Table.Th>Message</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {items.map((r) => {
              const senderId = r.reportedUserId || r.message?.sender?.id || r.reportedUser?.id;
              const messageId = r.message?.id;

              return (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <StatusBadge status={r.status} />
                  </Table.Td>

                  <Table.Td>
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}
                  </Table.Td>

                  <Table.Td>
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>
                        {r.reporter?.username || 'Unknown'}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {r.reporter?.email || 'no email'}
                      </Text>
                    </Stack>
                  </Table.Td>

                  <Table.Td>
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>
                        {r.reportedUser?.username ||
                          r.message?.sender?.username ||
                          'Unknown'}
                      </Text>

                      <Text size="xs" c="dimmed">
                        {r.reportedUser?.email || 'no email'}
                      </Text>

                      {r.message?.sender?.isBanned ? (
                        <Badge size="xs" color="red" variant="light">
                          Banned
                        </Badge>
                      ) : null}
                    </Stack>
                  </Table.Td>

                  <Table.Td>
                    <Stack gap={4}>
                      <Text size="xs" c="dimmed">
                        Message ID: {messageId || '—'}
                      </Text>

                      <Text size="sm" lineClamp={4}>
                        {getMessagePreview(r)}
                      </Text>

                      <Text size="xs" c="dimmed">
                        Reason: {r.reason || '—'}
                      </Text>

                      {r.details ? (
                        <Text size="xs" c="dimmed" lineClamp={3}>
                          Details: {r.details}
                        </Text>
                      ) : null}

                      {r.blockApplied ? (
                        <Badge size="xs" color="orange" variant="light">
                          Reporter blocked user
                        </Badge>
                      ) : null}

                      {r.priority ? (
                        <Badge size="xs" variant="light">
                          Priority: {r.priority}
                        </Badge>
                      ) : null}

                      {typeof r.severityScore === 'number' ? (
                        <Text size="xs" c="dimmed">
                          Severity: {r.severityScore.toFixed(2)}
                        </Text>
                      ) : null}

                      {r.aiCategory ? (
                        <Badge size="xs" color="grape" variant="light">
                          AI: {r.aiCategory}
                        </Badge>
                      ) : null}

                      <Text size="xs" c="dimmed">
                        Chat Room: {r.chatRoomId || r.message?.chatRoomId || '—'}
                      </Text>
                    </Stack>
                  </Table.Td>

                  <Table.Td>
                    <Group gap="xs">
                      {r.status === 'OPEN' ? (
                        <Button
                          size="xs"
                          onClick={() => {
                            setResolveId(r.id);
                            setNotes('');
                            open();
                          }}
                        >
                          Resolve
                        </Button>
                      ) : null}

                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => warnUser(senderId)}
                        disabled={!senderId}
                      >
                        Warn
                      </Button>

                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        onClick={() => banUser(senderId)}
                        disabled={!senderId}
                      >
                        Ban
                      </Button>

                      <Button
                        size="xs"
                        color="orange"
                        variant="light"
                        onClick={() => adminDeleteMessage(messageId)}
                        disabled={!messageId}
                      >
                        Delete Msg
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
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