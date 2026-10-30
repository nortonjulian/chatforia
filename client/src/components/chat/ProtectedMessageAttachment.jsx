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

export function useAuthorizedMedia(id, original, variant = 'file', viewerId, preserveSource = false, retryCount = 0) {
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
        if (!cancelled) {
          const authorizedUrl = toAbsolute(data.url);
          setResult((current) => {
            if (
              preserveSource &&
              current.scope === scope &&
              current.url
            ) {
              return current;
            }
            return { scope, url: authorizedUrl };
          });
        }
      } catch (error) {
        if (cancelled) return;

        const status = error?.response?.status;

        const isTemporaryFailure =
          !error?.response ||
          status === 408 ||
          status === 429 ||
          (status >= 500 && status <= 599);

        if (preserveSource && isTemporaryFailure) {
          return;
        }

        setResult({ scope, url: null });
        // Authorization denial clears the source.
        // Temporary failures never grant new access.
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
  }, [id, original, variant, local, scope, retryCount]);

  return { url: visibleUrl };
}

export default function ProtectedMessageAttachment({ attachment, index, viewerId }) {
  const original = attachment?.url;
  const [retryCount, setRetryCount] = useState(0);
  const [failedVideoScope, setFailedVideoScope] = useState(null);

  const videoScope =
    `${viewerId ?? 'anonymous'}:${attachment?.id}:${original ?? ''}`;

  const videoFailed = failedVideoScope === videoScope;

  const retryVideo = () => {
    setFailedVideoScope(null);
    setRetryCount((count) => count + 1);
  };

  const mime = String(attachment?.mimeType || '').toLowerCase();
  const kind = String(attachment?.kind || '').toUpperCase();
  const isAudio = kind === 'AUDIO' || mime.startsWith('audio/');
  const isVideo = kind === 'VIDEO' || mime.startsWith('video/');
  const isImage = kind === 'IMAGE' || kind === 'GIF' || mime.startsWith('image/');

  const file = useAuthorizedMedia(
    attachment?.id,
    original,
    'file',
    viewerId,
    isVideo,
    retryCount
  );
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
  if (isVideo) return (
    <div>
      <video
        controls
        preload="metadata"
        playsInline
        src={file.url || undefined}
        onError={() => setFailedVideoScope(videoScope)}
      style={{
        display: 'block',
        width: 260,
        maxWidth: '100%',
        aspectRatio:
          Number(attachment?.width) > 0 &&
          Number(attachment?.height) > 0
            ? `${Number(attachment.width)} / ${Number(attachment.height)}`
            : '9 / 16',
        objectFit: 'contain',
        borderRadius: 12,
        background: '#000',
      }}
      />
      {videoFailed && (
        <button
          type="button"
          onClick={retryVideo}
          style={{
            display: 'block',
            marginTop: 8,
            padding: '8px 12px',
            cursor: 'pointer',
          }}
        >
          Retry video
        </button>
      )}
    </div>
  );
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
