import { Tooltip, Group, Text, ActionIcon } from '@mantine/core'
import { RotateCw } from 'lucide-react'
import dayjs from 'dayjs'

export default function MessageBubble({ msg, onRetry }) {
  const ts = dayjs(msg.createdAt).format('MMM D, YYYY • h:mm A')

  const bubbleStyle = msg.mine
    ? {
        background: 'var(--bubble-outgoing, linear-gradient(135deg, #6A3CC1, #00C2A8))',
        color: 'var(--bubble-outgoing-text, #fff)',
        textShadow: 'var(--bubble-outgoing-shadow, none)',
      }
    : {
        background: 'var(--bubble-incoming, #f3f4f6)',
        color: 'var(--bubble-incoming-text, #111)',
      }

  return (
    <Group justify={msg.mine ? 'flex-end' : 'flex-start'} wrap="nowrap" align="flex-end" px="md">
      <Tooltip label={ts} withinPortal>
        <Text
          role="text"
          aria-label={`Message sent ${ts}`}
          px="md"
          py={8}
          maw="68%"
          style={{
            ...bubbleStyle,
            borderRadius: 18,
            wordBreak: 'break-word',
          }}
        >
          {msg.content}
        </Text>
      </Tooltip>

      {msg.failed && (
        <ActionIcon
          aria-label="Retry sending message"
          variant="subtle"
          onClick={() => onRetry?.(msg)}
          title="Retry"
        >
          <RotateCw />
        </ActionIcon>
      )}
    </Group>
  )
}
