import { Modal, SimpleGrid, Text, Stack } from '@mantine/core';
import SmsMessageMedia from './SmsMessageMedia.jsx';

export default function SmsMediaGalleryModal({ opened, onClose, title, items, accountKey }) {
  const list = Array.isArray(items) ? items : [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title ? `Media — ${title}` : 'Media'}
      size="lg"
      overlayProps={{ opacity: 0.25, blur: 2 }}
    >
      <Stack gap="sm">
        {!list.length ? (
          <Text c="dimmed" size="sm">No media yet.</Text>
        ) : (
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
            {list.map((it) => (
              <SmsMessageMedia
                key={it.id}
                messageId={it.messageId}
                mediaIndex={it.mediaIndex}
                item={it.item}
                accountKey={accountKey}
              />
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </Modal>
  );
}
