import { useEffect, useState } from 'react';
import {
  Card,
  Group,
  Stack,
  Text,
  Title,
  Badge,
  Button,
  Table,
  SimpleGrid,
  Alert,
  ScrollArea,
} from '@mantine/core';
import {
  getSupportSummary,
  getSupportTickets,
  updateSupportTicket,
} from '@/api/adminSupport';

function formatSupportLabel(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 'None';
  }

  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AdminSupport() {
  const [summary, setSummary] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    try {
      const [summaryData, ticketData] = await Promise.all([
        getSupportSummary(),
        getSupportTickets(),
      ]);

      setSummary(summaryData);
      setTickets(ticketData.tickets || []);
    } catch {
      setError('Unable to load support tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markTicket(id, status) {
    setError('');

    try {
      await updateSupportTicket(id, status);
      await load();
    } catch {
      setError('Unable to update ticket. Please try again.');
    }
  }

  const totals = summary?.totals || {};

  return (
    <Stack p="lg" gap="lg">
      <Group justify="space-between">
        <Title order={2}>Support Dashboard</Title>
        <Button onClick={load} loading={loading}>
          Refresh
        </Button>
      </Group>

      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
        <Card withBorder>
          <Text c="dimmed" size="sm">Total tickets</Text>
          <Title order={3}>{totals.totalTickets ?? 0}</Title>
        </Card>

        <Card withBorder>
          <Text c="dimmed" size="sm">Open</Text>
          <Title order={3}>{totals.openTickets ?? 0}</Title>
        </Card>

        <Card withBorder>
          <Text c="dimmed" size="sm">Escalated</Text>
          <Title order={3}>{totals.escalatedTickets ?? 0}</Title>
        </Card>

        <Card withBorder>
          <Text c="dimmed" size="sm">Auto-resolved</Text>
          <Title order={3}>{totals.autoResolvedTickets ?? 0}</Title>
        </Card>
      </SimpleGrid>

      <Card withBorder>
        <Title order={4} mb="sm">Top support categories</Title>
        <Stack gap="xs">
          {(summary?.topCategories || []).map((item) => (
            <Group key={item.category} justify="space-between">
              <Text>{formatSupportLabel(item.category)}</Text>
              <Badge>{item.count}</Badge>
            </Group>
          ))}
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">Top product issues</Title>

        <Stack gap="xs">
            {(summary?.topIssuesDetailed || []).map((item, i) => (
            <Group key={i} justify="space-between">
                <div>
                <Text fw={500}>{formatSupportLabel(item.category)}</Text>
                <Text size="xs" c="dimmed">
                    Action: {formatSupportLabel(item.action)}
                </Text>
                </div>

                <Badge color="red">{item.count}</Badge>
            </Group>
            ))}
        </Stack>
    </Card>

      <Card withBorder>
        <Title order={4} mb="sm">Recent tickets</Title>

        <ScrollArea type="auto" offsetScrollbars>
          <Table striped highlightOnHover style={{ minWidth: 850 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Support</Table.Th>
              <Table.Th>Message</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {tickets.map((ticket) => (
              <Table.Tr key={ticket.id}>
                <Table.Td>{ticket.id}</Table.Td>
                <Table.Td>{ticket.email}</Table.Td>
                <Table.Td>
                  <Badge style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {formatSupportLabel(ticket.status)}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge
                    style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    color={
                      ticket.supportLevel === 'PRIORITY'
                        ? 'red'
                        : ticket.supportLevel === 'EMAIL'
                          ? 'blue'
                          : 'gray'
                    }
                  >
                    {formatSupportLabel(ticket.supportLevel || 'STANDARD')}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text lineClamp={2}>{ticket.message}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => markTicket(ticket.id, 'resolved')}
                    >
                      Resolve
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      onClick={() => markTicket(ticket.id, 'escalated')}
                    >
                      Escalate
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>
    </Stack>
  );
}