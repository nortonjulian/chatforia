import { Group, Button } from '@mantine/core';

export default function SmartReplyBar({ suggestions = [], onPick }) {
  if (!suggestions.length) return null;

  return (
    <Group gap="xs" mt="xs" wrap="wrap">
      {suggestions.map((s, i) => {
        const text = typeof s === 'string' ? s : s?.text;
        if (!text) return null;

        return (
          <Button
            key={`${text}-${i}`}
            size="xs"
            variant="light"
            onClick={() => onPick?.(text)}
          >
            {text}
          </Button>
        );
      })}
    </Group>
  );
}