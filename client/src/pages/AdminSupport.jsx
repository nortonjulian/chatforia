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
} from '@mantine/core';
import {
  getSupportSummary,
  getSupportTickets,
  updateSupportTicket,
} from '@/api/adminSupport';

export default function AdminSupport() {
  const [summary, setSummary] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [summaryData, ticketData] = await Promise.all([
        getSupportSummary(),
        getSupportTickets(),
      ]);

      setSummary(summaryData);
      setTickets(ticketData.tickets || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markTicket(id, status) {
    await updateSupportTicket(id, status);
    await load();
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
              <Text>{item.category}</Text>
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
                <Text fw={500}>{item.category}</Text>
                <Text size="xs" c="dimmed">
                    Action: {item.action || 'None'}
                </Text>
                </div>

                <Badge color="red">{item.count}</Badge>
            </Group>
            ))}
        </Stack>
    </Card>

      <Card withBorder>
        <Title order={4} mb="sm">Recent tickets</Title>

        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Status</Table.Th>
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
                  <Badge>{ticket.status}</Badge>
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
      </Card>
    </Stack>
  );
}