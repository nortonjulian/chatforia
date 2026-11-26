import { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, SimpleGrid, Image, Text, Group, Button } from '@mantine/core';
import { getMediaInRoom } from '../utils/messagesStore';
import { messageCacheKey } from '../utils/messageCacheKey';
import { isLocalPrivateMedia, useAuthorizedMedia } from './chat/ProtectedMessageAttachment';
import SharedImageViewer from './chat/SharedImageViewer';
import { loadNativeImageBlob } from './chat/loadNativeImageBlob';

/**
 * MediaGalleryModal
 * - Pulls media from the local message cache (IndexedDB) via getMediaInRoom(roomId)
 * - Supports images, videos, and audio (attachments-first; falls back to legacy fields if present)
 * - Lightweight viewer modal for a single selected item
 */
function AuthorizedGallerySource({ item, accountId, children }) {
  const { url } = useAuthorizedMedia(
    Number.isSafeInteger(Number(item?.id)) ? item.id : item?.messageId,
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
  const [imageViewer, setImageViewer] = useState(null);
  const imageRequest = useRef(null);
  const returnImageIndex = useRef(null);
  const imageScope = `${accountId ?? 'anonymous'}:${roomId ?? 'none'}`;

  useEffect(() => {
    setImageViewer(null);
    setViewerIndex(null);
    imageRequest.current?.abort();
    return () => imageRequest.current?.abort();
  }, [imageScope]);

  const closeAll = () => {
    imageRequest.current?.abort();
    setImageViewer(null);
    setViewerIndex(null);
    onClose();
  };

  const openImage = async (item, index) => {
    imageRequest.current?.abort();
    const controller = new AbortController();
    imageRequest.current = controller;
    setImageViewer({ scope: imageScope, item, index, loading: true, blob: null, error: '' });
    try {
      const blob = await loadNativeImageBlob(item, {
        privateSource: isLocalPrivateMedia(item.url),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setImageViewer({ scope: imageScope, item, index, loading: false, blob, error: '' });
      }
    } catch {
      if (!controller.signal.aborted) {
        setImageViewer({
          scope: imageScope, item, index, loading: false, blob: null,
          error: 'Image unavailable. Check your access and try again.',
        });
      }
    }
  };

  const backToGallery = () => {
    returnImageIndex.current = imageViewer?.index ?? null;
    imageRequest.current?.abort();
    setImageViewer(null);
  };

  useEffect(() => {
    if (!opened || imageViewer || returnImageIndex.current == null) return undefined;
    const index = returnImageIndex.current;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-native-gallery-index="${index}"]`)?.focus();
      returnImageIndex.current = null;
    }, 250);
    return () => window.clearTimeout(timer);
  }, [opened, imageViewer]);

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
        opened={opened && imageViewer?.scope !== imageScope}
        onClose={closeAll}
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
                <button
                  type="button"
                  className="shared-image-inline-open"
                  data-native-gallery-index={i}
                  aria-label="Open image full size"
                  onClick={() => openImage(m, i)}
                >
                  <Image
                    key={m.id ?? `${m.url}-${i}`}
                    radius="md"
                    src={authorizedUrl || undefined}
                    alt={m.caption || t('mediaGallery.imageAlt', 'image')}
                  />
                </button>
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
        opened={viewerIndex != null && selected?.kind !== 'IMAGE'}
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
        {selected.kind === 'VIDEO' ? (
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
      <SharedImageViewer
        opened={opened && imageViewer?.scope === imageScope}
        onClose={closeAll}
        onBack={imageViewer?.scope === imageScope ? backToGallery : undefined}
        blob={imageViewer?.scope === imageScope ? imageViewer.blob : null}
        loading={imageViewer?.scope === imageScope && imageViewer.loading}
        error={imageViewer?.scope === imageScope ? imageViewer.error : ''}
        alt={imageViewer?.item?.caption || 'Chatforia image'}
        caption={imageViewer?.item?.caption || ''}
        expiresAt={imageViewer?.item?.expiresAt}
        filename="chatforia-image"
        onDownload={() => loadNativeImageBlob(imageViewer.item, {
          privateSource: isLocalPrivateMedia(imageViewer.item.url),
        })}
      />
    </>
  );
}
