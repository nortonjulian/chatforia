import { useEffect, useState } from 'react';
import { Button, Modal, SimpleGrid, Text, Stack } from '@mantine/core';
import SmsMessageMedia from './SmsMessageMedia.jsx';

export default function SmsMediaGalleryModal({ opened, onClose, title, items, accountKey }) {
  const list = Array.isArray(items) ? items : [];
  const [selection, setSelection] = useState(null);
  const selected = opened && selection?.accountKey === accountKey
    ? list.find((item) => item.id === selection.id)
    : null;

  useEffect(() => {
    if (!opened) setSelection(null);
  }, [opened]);

  return (
    <Modal
      opened={opened}
      onClose={() => { setSelection(null); onClose(); }}
      title={selected ? 'MMS image preview' : title ? `Media — ${title}` : 'Media'}
      aria-label={selected ? 'MMS image preview' : 'MMS media gallery'}
      size="lg"
      centered
      closeOnEscape
      trapFocus
      overlayProps={{ opacity: 0.25, blur: 2 }}
    >
      <Stack gap="sm">
        {selected ? <>
          <Button type="button" variant="subtle" onClick={() => setSelection(null)}>
            Back to media
          </Button>
          <SmsMessageMedia key={`${accountKey}:${selected.id}:viewer`}
            messageId={selected.messageId} mediaIndex={selected.mediaIndex}
            item={selected.item} accountKey={accountKey} presentation="viewer" />
        </> : !list.length ? (
          <Text c="dimmed" size="sm">No media yet.</Text>
        ) : (
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
            {list.map((it) => (
              <SmsMessageMedia
                key={it.id}
                messageId={it.messageId}
                mediaIndex={it.mediaIndex}
                item={it.item}
                accountKey={accountKey}
                presentation="gallery"
                onOpenImage={() => setSelection({ accountKey, id: it.id })}
              />
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </Modal>
  );
}
