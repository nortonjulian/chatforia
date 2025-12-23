import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  TextInput,
  Stack,
  Text,
  Group,
  Button,
  ScrollArea,
  Badge,
} from '@mantine/core';
import dayjs from 'dayjs';

export default function SmsSearchDrawer({
  opened,
  onClose,
  threadId,
  onJumpToMessage,
  searchFn, 
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!opened) {
      setQ('');
      setRows([]);
      setLoading(false);
    }
  }, [opened]);

  const canSearch = useMemo(() => String(q || '').trim().length >= 2, [q]);

  const run = async () => {
    if (!canSearch || !threadId) return;
    setLoading(true);
    try {
      const res = await searchFn(threadId, q, 50);
      setRows(res || []);
    } catch (e) {
      console.error('SMS search failed', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      title="Search"
      size="md"
      overlayProps={{ opacity: 0.25, blur: 2 }}
    >
      <Stack gap="sm">
        <Group gap="sm" align="flex-end">
          <TextInput
            label="Search this thread"
            placeholder="Type at least 2 characters…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run();
            }}
          />
          <Button onClick={run} disabled={!canSearch} loading={loading}>
            Search
          </Button>
        </Group>

        <ScrollArea h={520}>
          <Stack gap="xs">
            {!rows.length && !loading ? (
              <Text c="dimmed" size="sm">
                No results yet.
              </Text>
            ) : null}

            {rows.map((r) => {
              const ts = dayjs(r.createdAt).format('MMM D, YYYY • h:mm A');
              const snippet = r.body || '';
              return (
                <Button
                  key={r.key}
                  variant="subtle"
                  justify="space-between"
                  styles={{ inner: { justifyContent: 'space-between' } }}
                  onClick={() => {
                    onClose();
                    setTimeout(() => onJumpToMessage?.(r.id), 120);
                  }}
                >
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Badge size="sm" variant="light">
                      {r.direction === 'out' ? 'Sent' : 'Recv'}
                    </Badge>
                    <Text size="sm" truncate style={{ maxWidth: 260 }}>
                      {snippet}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {ts}
                  </Text>
                </Button>
              );
            })}
          </Stack>
        </ScrollArea>
      </Stack>
    </Drawer>
  );
}
