import { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import {
  Stack,
  Group,
  Title,
  TextInput,
  Button,
  Table,
  Alert,
  Select,
  Text,
} from '@mantine/core';

// tiny fallback toast (to avoid crashes if your real toast util isn't wired)
const toast = {
  ok: (m) => console.log(m),
  err: (m) => console.error(m),
  info: (m) => console.info(m),
};

export default function AdminVoiceLogsPage() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchLogs = async (notify = false) => {
    setLoading(true);
    setErr('');
    try {
      const res = await axiosClient.get('/admin/voice-logs', {
        params: {
          status,
          direction,
          phone,
          take: 50,
          skip: 0,
        },
      });
      const list = res.data?.items || [];
      setItems(list);
      if (notify && list.length === 0) {
        toast.info('No voice logs found for that filter.');
      }
    } catch (e) {
      const msg = e?.response?.data?.error || 'Failed to load voice logs';
      setErr(msg);
      if (notify) toast.err(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Voice Logs</Title>
        <Group>
          <Select
            placeholder="Status"
            value={status}
            onChange={setStatus}
            clearable
            data={[
              { value: 'QUEUED', label: 'QUEUED' },
              { value: 'RINGING', label: 'RINGING' },
              { value: 'IN_PROGRESS', label: 'IN_PROGRESS' },
              { value: 'COMPLETED', label: 'COMPLETED' },
              { value: 'FAILED', label: 'FAILED' },
              { value: 'BUSY', label: 'BUSY' },
              { value: 'NO_ANSWER', label: 'NO_ANSWER' },
            ]}
          />
          <Select
            placeholder="Direction"
            value={direction}
            onChange={setDirection}
            clearable
            data={[
              { value: 'inbound', label: 'Inbound' },
              { value: 'outbound-api', label: 'Outbound (API)' },
              { value: 'outbound-dial', label: 'Outbound (Dial)' },
            ]}
          />
          <TextInput
            placeholder="Phone contains…"
            value={phone}
            onChange={(e) => setPhone(e.currentTarget.value)}
          />
          <Button
            variant="light"
            loading={loading}
            onClick={() => fetchLogs(true)}
          >
            Search
          </Button>
        </Group>
      </Group>

      {err && (
        <Alert color="red" variant="light">
          {err}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>When</Table.Th>
            <Table.Th>From</Table.Th>
            <Table.Th>To</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Direction</Table.Th>
            <Table.Th>Duration</Table.Th>
            <Table.Th>Answered By</Table.Th>
            <Table.Th>Call SID</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((i) => {
            const when = new Date(
              i.timestamp || i.createdAt || Date.now()
            ).toLocaleString();
            const dur =
              i.durationSec != null ? `${i.durationSec}s` : '—';
            return (
              <Table.Tr key={i.id}>
                <Table.Td>{when}</Table.Td>
                <Table.Td>{i.from || <Text c="dimmed">Unknown</Text>}</Table.Td>
                <Table.Td>{i.to || <Text c="dimmed">Unknown</Text>}</Table.Td>
                <Table.Td>{i.status}</Table.Td>
                <Table.Td>{i.direction || '—'}</Table.Td>
                <Table.Td>{dur}</Table.Td>
                <Table.Td>{i.answeredBy || '—'}</Table.Td>
                <Table.Td>
                  <code style={{ fontSize: 11 }}>{i.callSid}</code>
                </Table.Td>
              </Table.Tr>
            );
          })}
          {items.length === 0 && !loading && (
            <Table.Tr>
              <Table.Td colSpan={8} style={{ opacity: 0.7 }}>
                No voice logs to display.
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
