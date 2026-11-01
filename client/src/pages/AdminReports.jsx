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
  ScrollArea,
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
  const [evidenceReport, setEvidenceReport] = useState(null);

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
        <ScrollArea type="auto" offsetScrollbars>
          <Table
            striped
            highlightOnHover
            withTableBorder
            style={{ minWidth: 850 }}
          >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Status</Table.Th>
              <Table.Th>Reported At</Table.Th>
              <Table.Th>Reporter</Table.Th>
              <Table.Th>Reported Party</Table.Th>
              <Table.Th>Message</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {items.map((r) => {
              const isPstn = r.reportType === 'PSTN';
              const senderId = isPstn
                ? null
                : r.reportedUserId || r.message?.sender?.id || r.reportedUser?.id;
              const messageId = isPstn
                ? r.smsMessageId
                : r.message?.id;

              return (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Stack gap={4} align="flex-start">
                      <StatusBadge status={r.status} />
                      <Badge
                        size="xs"
                        variant="light"
                        color={isPstn ? 'blue' : 'gray'}
                      >
                        {isPstn ? 'SMS/MMS' : 'Chatforia'}
                      </Badge>
                    </Stack>
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
                          {isPstn
                            ? r.reportedPhone || 'Unknown phone number'
                            : r.reportedUser?.username ||
                              r.message?.sender?.username ||
                              'Unknown'}
                        </Text>

                        <Text size="xs" c="dimmed">
                          {isPstn
                            ? 'External SMS/MMS number'
                            : r.reportedUser?.email || 'no email'}
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
                        {isPstn ? 'SMS Message ID' : 'Message ID'}: {messageId || '—'}
                      </Text>

                      {isPstn && (
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => setEvidenceReport(r)}
                        >
                          View evidence
                        </Button>
                      )}

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
                          {isPstn ? 'Reporter blocked number' : 'Reporter blocked user'}
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
                        disabled
                        title="User warnings are not yet available"
                      >
                        Warn
                      </Button>

                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        onClick={() => banUser(senderId)}
                        disabled={isPstn || !senderId}
                      >
                        Ban
                      </Button>

                      <Button
                        size="xs"
                        color="orange"
                        variant="light"
                        onClick={() => adminDeleteMessage(messageId)}
                        disabled={isPstn || !messageId}
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
        </ScrollArea>
      )}

      <Modal
        opened={Boolean(evidenceReport)}
        onClose={() => setEvidenceReport(null)}
        title="SMS/MMS report evidence"
        centered
        radius="lg"
        size="lg"
      >
        {evidenceReport && (
          <Stack gap="md">
            <Text size="sm">
              <strong>Reported number:</strong>{' '}
              {evidenceReport.reportedPhone || 'Unknown'}
            </Text>

            <Text size="sm">
              <strong>SMS Message ID:</strong>{' '}
              {evidenceReport.smsMessageId || '—'}
            </Text>

            <Text size="sm">
              <strong>Reason:</strong>{' '}
              {evidenceReport.reason || 'Not provided'}
            </Text>

            <Card withBorder>
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  Reported message
                </Text>
                <Text
                  size="sm"
                  style={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {getMessagePreview(evidenceReport)}
                </Text>
              </Stack>
            </Card>

            <Stack gap="xs">
              <Text fw={600} size="sm">
                Included conversation context
              </Text>

              {Array.isArray(evidenceReport.evidence?.contextMessages) &&
              evidenceReport.evidence.contextMessages.length > 0 ? (
                evidenceReport.evidence.contextMessages.map((message, index) => (
                  <Card withBorder key={message.id ?? index}>
                    <Stack gap={4}>
                      <Text size="xs" c="dimmed">
                        {message.direction === 'in' ? 'Incoming' : 'Outgoing'}
                        {' · '}
                        {message.createdAt
                          ? new Date(message.createdAt).toLocaleString()
                          : 'Unknown date'}
                      </Text>

                      <Text
                        size="sm"
                        style={{
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {message.text || '[No text]'}
                      </Text>

                      {Array.isArray(message.mediaUrls) &&
                        message.mediaUrls.length > 0 && (
                          <Text size="xs" c="dimmed">
                            {message.mediaUrls.length} media attachment(s)
                            included in evidence
                          </Text>
                        )}
                    </Stack>
                  </Card>
                ))
              ) : (
                <Text size="sm" c="dimmed">
                  No previous messages were included in this report.
                </Text>
              )}
            </Stack>

            <Button
              variant="light"
              onClick={() => setEvidenceReport(null)}
            >
              Close
            </Button>
          </Stack>
        )}
      </Modal>

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