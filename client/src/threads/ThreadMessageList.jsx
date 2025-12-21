import { Box, Group, Paper, Text } from '@mantine/core';

export default function ThreadMessageList({
  messages = [],
  getKey = (m) => m.id,
  isOutgoing = () => false,
  renderBody = (m) => m.body || m.content || '',
  maxBubbleWidth = 420,
  emptyText = 'Say hello 👋',
}) {
  if (!messages.length) {
    return (
      <Text c="dimmed" ta="center" py="md">
        {emptyText}
      </Text>
    );
  }

  return (
    <Box>
      {messages.map((m) => {
        const mine = !!isOutgoing(m);

        return (
          <Group
            key={getKey(m)}
            justify={mine ? 'flex-end' : 'flex-start'}
            align="flex-end"
            wrap="nowrap"
            mb={8}
          >
            <Paper
              radius="lg"
              px="md"
              py="xs"
              style={{
                maxWidth: maxBubbleWidth,
                background: mine
                  ? 'var(--mantine-color-blue-filled)'
                  : 'var(--mantine-color-gray-2)',
                color: mine ? 'white' : 'var(--mantine-color-text)',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}
            >
              {typeof renderBody === 'function' ? renderBody(m) : String(renderBody)}
            </Paper>
          </Group>
        );
      })}
    </Box>
  );
}
