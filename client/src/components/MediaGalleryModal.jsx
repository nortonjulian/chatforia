import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, SimpleGrid, Image, Text, Group, Button } from '@mantine/core';
import { getMediaInRoom } from '../utils/messagesStore';
import { messageCacheKey } from '../utils/messageCacheKey';
import { useAuthorizedMedia } from './chat/ProtectedMessageAttachment';

/**
 * MediaGalleryModal
 * - Pulls media from the local message cache (IndexedDB) via getMediaInRoom(roomId)
 * - Supports images, videos, and audio (attachments-first; falls back to legacy fields if present)
 * - Lightweight viewer modal for a single selected item
 */
function AuthorizedGallerySource({ item, accountId, children }) {
  const { url } = useAuthorizedMedia(
    item?.messageId,
    item?.url,
    'file',
    accountId,
    String(item?.kind || '').toUpperCase() === 'VIDEO'
  );

  return children(url);
}

export default function MediaGalleryModal({ opened, onClose, roomId, accountId }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(null);

  // load cached media when opened
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!opened) return;
      if (!accountId || !roomId) {
        if (alive) setItems([]);
        return;
      }
      const media = await getMediaInRoom(messageCacheKey(accountId, roomId));
      // Expecting items like:
      // { id, kind: 'IMAGE'|'VIDEO'|'AUDIO', url, mimeType?, caption?, width?, height?, durationSec?, messageId? }
      // Fallbacks (legacy): some stores may return { imageUrl } only for images.
      if (alive) {
        const normalized = (Array.isArray(media) ? media : [])
          .map((m) => {
            // Try to infer kind if missing
            const url = m.url || m.imageUrl || m.audioUrl || m.videoUrl || '';
            const mime = m.mimeType || '';
            const kind =
              m.kind ||
              (mime.startsWith('image/')
                ? 'IMAGE'
                : mime.startsWith('video/')
                  ? 'VIDEO'
                  : mime.startsWith('audio/')
                    ? 'AUDIO'
                    : m.imageUrl
                      ? 'IMAGE'
                      : null) ||
              'FILE';
            return { ...m, url, kind };
          })
          .filter((m) => m.url); // only display if we have a URL
        setItems(normalized.reverse()); // newest first
      }
    })();
    return () => {
      alive = false;
    };
  }, [opened, roomId, accountId]);

  const selected = useMemo(
    () => (viewerIndex != null ? items[viewerIndex] : null),
    [viewerIndex, items]
  );

  const closeViewer = () => setViewerIndex(null);

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={t('mediaGallery.sharedMedia', 'Shared media')}
        size="lg"
        centered
        padding="md"
        withCloseButton
        closeOnEscape
        trapFocus
        aria-label={t('mediaGallery.sharedMedia', 'Shared media')}
      >
        {items.length === 0 ? (
          <Text c="dimmed">
            {t('mediaGallery.noMediaCached', 'No media cached locally yet.')}
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
            {items.map((m, i) => (
              <AuthorizedGallerySource
                key={m.id ?? `${m.url}-${i}`}
                item={m}
                accountId={accountId}
              >
                {(authorizedUrl) => (
              m.kind === 'IMAGE' ? (
                <Image
                  key={m.id ?? `${m.url}-${i}`}
                  radius="md"
                  src={authorizedUrl || undefined}
                  alt={m.caption || t('mediaGallery.imageAlt', 'image')}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setViewerIndex(i)}
                />
              ) : m.kind === 'VIDEO' ? (
                <div
                  key={m.id ?? `${m.url}-${i}`}
                  style={{
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                  onClick={() => setViewerIndex(i)}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    m.caption
                      ? t('mediaGallery.openVideoWithCaption', 'Open video: {{caption}}', {
                          caption: m.caption,
                        })
                      : t('mediaGallery.openVideo', 'Open video')
                  }
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setViewerIndex(i)}
                >
                  <video
                    src={authorizedUrl || undefined}
                    style={{ width: '100%', display: 'block' }}
                    preload="metadata"
                    muted
                  />
                </div>
              ) : m.kind === 'AUDIO' ? (
                <div key={m.id ?? `${m.url}-${i}`} style={{ paddingTop: 6 }}>
                  <audio
                    src={authorizedUrl || undefined}
                    style={{ width: '100%' }}
                    controls
                    preload="metadata"
                  />
                </div>
              ) : null
                )}
              </AuthorizedGallerySource>
            ))}
          </SimpleGrid>
        )}
      </Modal>

      <Modal
        opened={viewerIndex != null}
        onClose={closeViewer}
        withCloseButton
        centered
        size="lg"
        padding="md"
        title={
          selected?.caption ||
          (selected?.kind
            ? t(`mediaGallery.kinds.${selected.kind.toLowerCase()}`, selected.kind.toLowerCase())
            : t('mediaGallery.preview', 'preview'))
        }
        closeOnEscape
        trapFocus
        aria-label={
          selected?.caption
            ? t('mediaGallery.previewWithCaption', 'Preview: {{caption}}', {
                caption: selected.caption,
              })
            : selected?.kind
              ? t(
                  'mediaGallery.previewKind',
                  'Preview {{kind}}',
                  {
                    kind: t(
                      `mediaGallery.kinds.${selected.kind.toLowerCase()}`,
                      selected.kind.toLowerCase()
                    ),
                  }
                )
              : t('mediaGallery.preview', 'Preview')
        }
      >
        {selected && (
          <AuthorizedGallerySource
            key={`${accountId}:${selected.messageId}:${selected.id}`}
            item={selected}
            accountId={accountId}
          >
            {(authorizedUrl) => (
              <>
        {selected.kind === 'IMAGE' ? (
          <>
            <Image
              radius="md"
              src={authorizedUrl || undefined}
              alt={selected.caption || t('mediaGallery.imageAlt', 'image')}
              fit="contain"
              styles={{ image: { maxHeight: '70vh' } }}
            />
            {selected.caption && (
              <Text size="sm" mt="sm" c="dimmed">
                {selected.caption}
              </Text>
            )}
          </>
        ) : selected.kind === 'VIDEO' ? (
          <>
            <video
              src={authorizedUrl || undefined}
              style={{
                width: '100%',
                maxHeight: '70vh',
                display: 'block',
                borderRadius: 8,
              }}
              controls
              preload="metadata"
            />
            {selected.caption && (
              <Text size="sm" mt="sm" c="dimmed">
                {selected.caption}
              </Text>
            )}
          </>
        ) : selected.kind === 'AUDIO' ? (
          <>
            <audio
              src={authorizedUrl || undefined}
              style={{ width: '100%' }}
              controls
              preload="metadata"
            />
            {selected.caption && (
              <Text size="sm" mt="sm" c="dimmed">
                {selected.caption}
              </Text>
            )}
          </>
        ) : null}

        {authorizedUrl && (
          <Group justify="flex-end" mt="md">
            <Button
              component="a"
              href={authorizedUrl}
              download
              variant="light"
              aria-label={t(
                'mediaGallery.downloadKind',
                'Download {{kind}}',
                {
                  kind: selected?.kind
                    ? t(
                        `mediaGallery.kinds.${selected.kind.toLowerCase()}`,
                        selected.kind.toLowerCase()
                      )
                    : t('mediaGallery.file', 'file'),
                }
              )}
            >
              {t('mediaGallery.download', 'Download')}
            </Button>
          </Group>
        )}
              </>
            )}
          </AuthorizedGallerySource>
        )}
      </Modal>
    </>
  );
}