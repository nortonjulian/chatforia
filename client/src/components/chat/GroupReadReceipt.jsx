import { useState } from 'react';
import { Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { groupReceiptReaders } from '@/utils/groupReadReceipts';

export default function GroupReadReceipt({ message }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const readers = groupReceiptReaders(message);
  if (!readers.length) return null;

  const label = readers.length === 1
    ? t('chat.receipts.groupReader', { defaultValue: 'Read by {{name}}', name: readers[0].name })
    : t('chat.receipts.groupReaders', { defaultValue: 'Read by {{count}}', count: readers.length });

  return (
    <Text component="div" size="xs" c="dimmed" ta="right" mt={4} mr={6}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}
      >
        {label}
      </button>
      {expanded && (
        <ul
          aria-label={t('chat.receipts.readers', { defaultValue: 'Readers' })}
          style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}
        >
          {readers.map((reader) => <li key={reader.id}>{reader.name}</li>)}
        </ul>
      )}
    </Text>
  );
}
