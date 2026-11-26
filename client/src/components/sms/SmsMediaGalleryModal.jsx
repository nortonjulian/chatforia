import { useEffect, useRef, useState } from 'react';
import { Modal, SimpleGrid, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import SharedImageViewer from '@/components/chat/SharedImageViewer';
import SmsMessageMedia from './SmsMessageMedia.jsx';

export default function SmsMediaGalleryModal({ opened, onClose, title, items, accountKey }) {
  const list = Array.isArray(items) ? items : [];
  const [selection, setSelection] = useState(null);
  const returnTile = useRef(null);
  const selected = opened && selection?.accountKey === accountKey
    ? list.find((item) => item.id === selection.id)
    : null;

  useEffect(() => {
    if (!opened) setSelection(null);
  }, [opened]);
  useEffect(() => {
    setSelection(null);
    returnTile.current = null;
  }, [accountKey]);

  const closeGallery = () => {
    setSelection(null);
    onClose();
  };
  const backToGallery = () => {
    returnTile.current = selected?.id ?? null;
    setSelection(null);
  };
  useEffect(() => {
    if (!opened || selected || !returnTile.current) return undefined;
    const id = returnTile.current;
    const timer = window.setTimeout(() => {
      document.querySelectorAll('[data-sms-gallery-id]').forEach((tile) => {
        if (tile.getAttribute('data-sms-gallery-id') === id) tile.focus();
      });
      returnTile.current = null;
    }, 250);
    return () => window.clearTimeout(timer);
  }, [opened, selected]);

  return (
    <>
    <Modal
      opened={opened && !selected}
      onClose={closeGallery}
      title={title ? `Media — ${title}` : 'Media'}
      aria-label="MMS media gallery"
      size="lg"
      centered
      closeOnEscape
      trapFocus
      overlayProps={{ opacity: 0.25, blur: 2 }}
    >
        {!list.length ? (
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
                caption={it.caption}
                galleryId={it.id}
                presentation="gallery"
                onOpenImage={({ blob }) => setSelection({ accountKey, id: it.id, blob })}
              />
            ))}
          </SimpleGrid>
        )}
    </Modal>
    <SharedImageViewer
      opened={Boolean(selected)}
      onClose={closeGallery}
      onBack={selected ? backToGallery : undefined}
      blob={selected ? selection.blob : null}
      alt="MMS attachment"
      caption={selected?.caption || ''}
      filename="mms-image"
      onDownload={async () => {
        if (!selected) throw new Error('Image unavailable');
        const path = `/sms/media/${selected.messageId}/${selected.mediaIndex}?cacheScope=${encodeURIComponent(accountKey || '')}`;
        const { data, headers } = await axiosClient.get(path, { responseType: 'blob' });
        return data instanceof Blob
          ? data
          : new Blob([data], { type: headers?.['content-type'] || 'application/octet-stream' });
      }}
    />
    </>
  );
}
