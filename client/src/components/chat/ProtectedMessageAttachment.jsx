import { useEffect, useState } from 'react';
import axiosClient from '@/api/axiosClient';

/*
 * Persisted local message media is not public. Fetch a user-authorized,
 * short-lived download capability before passing it to native browser media
 * elements, which cannot attach our authenticated axios headers.
 * Remote provider/CDN URLs are a separate storage contract and are unchanged.
 */
export function isLocalPrivateMedia(value) {
  if (typeof value !== 'string') return false;
  return /^\/?(?:uploads\/)?(?:media|thumbs)\/[A-Za-z0-9_.-]+$/.test(value.trim());
}

function toAbsolute(url) {
  const base = axiosClient.defaults.baseURL || window.location.origin;
  return new URL(url, base.endsWith('/') ? base : base + '/').href;
}

function useAuthorizedMedia(id, original, variant = 'file') {
  const local = isLocalPrivateMedia(original);
  const [result, setResult] = useState(() => local ? null : original);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!local) {
      setResult(original || null);
      return undefined;
    }
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
      setResult(null); // optimistic items have no authoritative ACL yet
      return undefined;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const { data } = await axiosClient.get(`/private-media/message/${id}`, {
          params: { variant }, headers: { 'Cache-Control': 'no-store' },
        });
        if (!cancelled) setResult(toAbsolute(data.url));
      } catch {
        if (!cancelled) setResult(null); // never fall back to public local path
      }
    };

    setResult(null);
    refresh();
    // Tokens expire after 60s; renew while viewing without storing them.
    const interval = window.setInterval(refresh, 40000);
    const onFocus = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [id, original, variant, local, revision]);

  return { url: result, retry: () => setRevision(v => v + 1) };
}

export default function ProtectedMessageAttachment({ attachment, index }) {
  const original = attachment?.url;
  const mime = String(attachment?.mimeType || '').toLowerCase();
  const kind = String(attachment?.kind || '').toUpperCase();
  const isAudio = kind === 'AUDIO' || mime.startsWith('audio/');
  const isVideo = kind === 'VIDEO' || mime.startsWith('video/');
  const isImage = kind === 'IMAGE' || kind === 'GIF' || mime.startsWith('image/');

  const file = useAuthorizedMedia(attachment?.id, original);
  const preview = useAuthorizedMedia(
    attachment?.id, attachment?.thumbUrl || attachment?.thumbnailUrl || original,
    attachment?.thumbUrl || attachment?.thumbnailUrl ? 'thumb' : 'file'
  );

  const key = attachment?.id ?? `pending-${index}`;
  if (!file.url && !(isImage && preview.url)) {
    return <span key={key} role="status">Media unavailable or loading…</span>;
  }
  if (isAudio) return <audio controls src={file.url || undefined} onError={file.retry} style={{ width: 260, maxWidth: '100%' }} />;
  if (isVideo) return <video controls src={file.url || undefined} onError={file.retry} style={{ width: 260, maxWidth: '100%', borderRadius: 12 }} />;
  if (isImage) {
    const display = preview.url || file.url;
    return (
      <a href={file.url || display} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block' }}>
        <img src={display} alt="Attachment" onError={preview.retry}
          style={{ width: 220, maxWidth: '100%', borderRadius: 12 }} />
      </a>
    );
  }
  return <a href={file.url} target="_blank" rel="noopener noreferrer">
    {attachment?.originalName || attachment?.caption || 'Open file'}
  </a>;
}
