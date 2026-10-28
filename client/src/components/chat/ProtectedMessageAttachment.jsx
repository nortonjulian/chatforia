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
  const raw = value.trim();
  // New uploads are persisted as canonical R2 keys, not just CDN URLs.
  // Do not let browser media elements try to fetch private storage directly.
  if (raw.startsWith('uploads/')) {
    const parts = raw.split('/');
    if (parts.length >= 3 && parts[0] === 'uploads' &&
        /^u[1-9][0-9]*$/.test(parts[1]) &&
        parts.slice(2).every(part => /^[A-Za-z0-9._-]{1,200}$/.test(part) &&
          part !== '.' && part !== '..')) return true;
  }
  if (/^\/?(?:uploads\/)?(?:media|thumbs)\/[A-Za-z0-9_.-]+$/.test(raw)) return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'cdn.chatforia.com' &&
      !url.search && !url.hash &&
      /^\/uploads\/u[1-9][0-9]*\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function toAbsolute(url) {
  const base = axiosClient.defaults.baseURL || window.location.origin;
  return new URL(url, base.endsWith('/') ? base : base + '/').href;
}

function useAuthorizedMedia(id, original, variant = 'file', viewerId) {
  const local = isLocalPrivateMedia(original);
  const scope = `${viewerId ?? 'anonymous'}:${id}:${variant}:${original ?? ''}`;
  const [result, setResult] = useState(() => ({
    scope, url: local ? null : (original || null),
  }));
  const visibleUrl = result.scope === scope ? result.url : null;

  useEffect(() => {
    if (!local) {
      setResult({ scope, url: original || null });
      return undefined;
    }
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
      setResult({ scope, url: null }); // optimistic items have no authoritative ACL yet
      return undefined;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const { data } = await axiosClient.get(`/private-media/message/${id}`, {
          params: { variant }, headers: { 'Cache-Control': 'no-store' },
        });
        if (!cancelled) setResult({ scope, url: toAbsolute(data.url) });
      } catch {
        if (!cancelled) setResult({ scope, url: null }); // never fall back to public local path
      }
    };

    setResult({ scope, url: null });
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
  }, [id, original, variant, local, scope]);

  return { url: visibleUrl };
}

export default function ProtectedMessageAttachment({ attachment, index, viewerId }) {
  const original = attachment?.url;
  const mime = String(attachment?.mimeType || '').toLowerCase();
  const kind = String(attachment?.kind || '').toUpperCase();
  const isAudio = kind === 'AUDIO' || mime.startsWith('audio/');
  const isVideo = kind === 'VIDEO' || mime.startsWith('video/');
  const isImage = kind === 'IMAGE' || kind === 'GIF' || mime.startsWith('image/');

  const file = useAuthorizedMedia(attachment?.id, original, 'file', viewerId);
  // Only fetch a second URL when an image actually has a separate thumbnail.
  // Otherwise reuse the already-authorized original; do not issue twice.
  const thumbnail = isImage
    ? (attachment?.thumbUrl || attachment?.thumbnailUrl || null)
    : null;
  const preview = useAuthorizedMedia(
    attachment?.id, thumbnail, 'thumb', viewerId
  );

  const key = attachment?.id ?? `pending-${index}`;
  if (!file.url && !(isImage && preview.url)) {
    return <span key={key} role="status">Media unavailable or loading…</span>;
  }
  if (isAudio) return <audio controls src={file.url || undefined} style={{ width: 260, maxWidth: '100%' }} />;
  if (isVideo) return <video controls src={file.url || undefined} style={{ width: 260, maxWidth: '100%', borderRadius: 12 }} />;
  if (isImage) {
    const display = preview.url || file.url;
    return (
      <a href={file.url || display} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block' }}>
        <img src={display} alt="Attachment"
          style={{ width: 220, maxWidth: '100%', borderRadius: 12 }} />
      </a>
    );
  }
  return <a href={file.url} target="_blank" rel="noopener noreferrer">
    {attachment?.originalName || attachment?.caption || 'Open file'}
  </a>;
}
