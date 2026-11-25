import { useEffect, useRef, useState } from 'react';
import { Button, Group, Modal, Text } from '@mantine/core';
import './SharedImageViewer.css';

export const IMAGE_VIEWER_WIDTH = 'min(96vw, 1200px)';
export const IMAGE_VIEWER_HEIGHT = 'calc(94dvh - 170px)';
export const CAPTIONED_IMAGE_VIEWER_HEIGHT = 'calc(94dvh - 205px)';

const extensionForMime = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export function imageDownloadName(blob, preferredName = 'chatforia-image') {
  const extension = extensionForMime[String(blob?.type || '').toLowerCase()] || 'bin';
  const clean = String(preferredName || 'chatforia-image')
    .split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '-');
  const stem = clean.replace(/\.[A-Za-z0-9]{1,6}$/, '') || 'chatforia-image';
  return `${stem}.${extension}`;
}

export default function SharedImageViewer({
  opened,
  onClose,
  blob,
  loading = false,
  error = '',
  alt = 'Image attachment',
  caption = '',
  expiresAt,
  filename = 'chatforia-image',
  onBack,
  onDownload,
}) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const openGeneration = useRef(0);

  useEffect(() => {
    if (!opened || !(blob instanceof Blob)) {
      setObjectUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [opened, blob]);

  useEffect(() => {
    openGeneration.current += 1;
    if (!opened) {
      setDownloading(false);
      setDownloadError('');
    }
  }, [opened]);

  useEffect(() => {
    if (!opened || !expiresAt) return undefined;
    const deadline = new Date(expiresAt).getTime();
    if (!Number.isFinite(deadline)) return undefined;
    let timer;
    const checkExpiry = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) onClose();
      else timer = window.setTimeout(checkExpiry, Math.min(remaining, 0x7fffffff));
    };
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [opened, expiresAt, onClose]);

  const download = async () => {
    if (!blob || downloading) return;
    const generation = openGeneration.current;
    setDownloading(true);
    setDownloadError('');
    try {
      // Recheck access at download time. The displayed image alone is not a
      // durable capability after membership changes or media expiration.
      const fresh = await onDownload();
      if (generation !== openGeneration.current) return;
      if (!(fresh instanceof Blob)) throw new Error('Image unavailable');
      const url = URL.createObjectURL(fresh);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = imageDownloadName(fresh, filename);
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      if (generation === openGeneration.current) {
        setDownloadError('Could not download this image. Check your access and try again.');
      }
    } finally {
      if (generation === openGeneration.current) setDownloading(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Image viewer"
      aria-label="Image viewer"
      withCloseButton={false}
      centered
      size={IMAGE_VIEWER_WIDTH}
      closeOnEscape
      trapFocus
      returnFocus
      classNames={{
        content: `shared-image-viewer-content${caption ? ' shared-image-viewer-with-caption' : ''}`,
        body: 'shared-image-viewer-body',
      }}
    >
      <Group justify="space-between" gap="sm" className="shared-image-viewer-header">
        {onBack ? (
          <Button type="button" variant="default" className="shared-image-viewer-control" onClick={onBack}>
            Back to media
          </Button>
        ) : <span />}
        <Button type="button" variant="default" className="shared-image-viewer-control" onClick={onClose}>
          Close
        </Button>
      </Group>
      <div className="shared-image-viewer-stage">
        {loading ? <Text role="status">Loading image…</Text> : error ? (
          <Text role="alert">{error}</Text>
        ) : objectUrl ? (
          <img className="shared-image-viewer-image" src={objectUrl} alt={alt} />
        ) : <Text role="status">Image unavailable.</Text>}
      </div>
      {caption && <Text className="shared-image-viewer-caption">{caption}</Text>}
      <Group justify="flex-end" className="shared-image-viewer-footer">
        {downloadError && <Text role="alert" size="sm">{downloadError}</Text>}
        <Button
          type="button"
          variant="default"
          className="shared-image-viewer-control"
          onClick={download}
          disabled={!blob || !onDownload || loading || Boolean(error) || downloading}
          loading={downloading}
          aria-label="Download image"
        >
          Download
        </Button>
      </Group>
    </Modal>
  );
}
