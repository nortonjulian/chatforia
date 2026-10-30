import { useEffect, useRef, useState } from 'react';
import axiosClient from '@/api/axiosClient';
import { Button } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

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
    scope,
    url: local ? null : (original || null),
    issuedAt: 0,
    latestUrl: null,
    latestAt: 0,
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
          const issuedAt = Date.now();

          setResult((current) => {
            if (
              preserveSource &&
              current.scope === scope &&
              current.url
            ) {
              return {
                ...current,
                latestUrl: authorizedUrl,
                latestAt: issuedAt,
              };
            }

            return {
              scope,
              url: authorizedUrl,
              issuedAt,
              latestUrl: authorizedUrl,
              latestAt: issuedAt,
            };
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

  const activateForPlayback = async () => {
    if (!local || result.scope !== scope) return false;

    // Use a recent background renewal without an extra network request.
    if (
      result.latestUrl &&
      result.latestUrl !== visibleUrl &&
      Date.now() - result.latestAt < 45000
    ) {
      setResult((current) =>
        current.scope === scope
          ? {
              ...current,
              url: current.latestUrl,
              issuedAt: current.latestAt,
            }
          : current
      );
      return true;
    }

    // The cached renewal is itself too old. Request a new capability.
    try {
      const { data } = await axiosClient.get(
        `/private-media/message/${id}`,
        {
          params: { variant },
          headers: { 'Cache-Control': 'no-store' },
        }
      );

      const authorizedUrl = toAbsolute(data.url);
      const issuedAt = Date.now();

      setResult((current) =>
        current.scope === scope
          ? {
              scope,
              url: authorizedUrl,
              issuedAt,
              latestUrl: authorizedUrl,
              latestAt: issuedAt,
            }
          : current
      );

      return true;
    } catch (error) {
      const status = error?.response?.status;
      const temporary =
        !error?.response ||
        status === 408 ||
        status === 429 ||
        (status >= 500 && status <= 599);

      if (!temporary) {
        setResult((current) =>
          current.scope === scope
            ? { scope, url: null, issuedAt: 0 }
            : current
        );
      }

      return false;
    }
  };

  return {
    url: visibleUrl,
    issuedAt: result.scope === scope ? result.issuedAt : 0,
    activateForPlayback,
  };
}

export default function ProtectedMessageAttachment({ attachment, index, viewerId }) {
  const original = attachment?.url;
  const [retryCount, setRetryCount] = useState(0);
  const [failedVideoScope, setFailedVideoScope] = useState(null);
  const recoveringVideoRef = useRef(false);
  const pendingPlaybackRef = useRef(null);

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

  const recoverVideo = async (video) => {
    if (
      !isVideo ||
      !isLocalPrivateMedia(original) ||
      !file.url ||
      !file.issuedAt ||
      Date.now() - file.issuedAt < 50000 ||
      recoveringVideoRef.current
    ) {
      return;
    }

    recoveringVideoRef.current = true;

    const position = video.currentTime || 0;
    video.pause();

    pendingPlaybackRef.current = {
      scope: videoScope,
      position,
      resume: true,
    };

    try {
      const recovered = await file.activateForPlayback();

      if (!recovered) {
        pendingPlaybackRef.current = null;
        setFailedVideoScope(videoScope);
      }
    } finally {
      recoveringVideoRef.current = false;
    }
  };

  const restoreVideoPlayback = (video) => {
    const pending = pendingPlaybackRef.current;

    if (!pending || pending.scope !== videoScope) return;

    pendingPlaybackRef.current = null;

    try {
      if (pending.position > 0) {
        video.currentTime = pending.position;
      }
    } catch {
      // Some browsers reject seeking before enough media is available.
    }

    if (pending.resume) {
      const attempt = video.play();
      attempt?.catch?.(() => {
        setFailedVideoScope(videoScope);
      });
    }
  };

  const key = attachment?.id ?? `pending-${index}`;
  if (!file.url && !(isImage && preview.url)) {
    return <span key={key} role="status">Media unavailable or loading…</span>;
  }
  if (isAudio) return <audio controls src={file.url || undefined} style={{ width: 260, maxWidth: '100%' }} />;
  if (isVideo) return (
    <div>
      <video
        data-chatforia-message-video
        controls
        preload="metadata"
        playsInline
        src={file.url || undefined}
        onPlay={(event) => {
          const current = event.currentTarget;

          // Only coordinate message attachments in this document.
          // Pausing another player never resets its position or source.
          current.ownerDocument
            .querySelectorAll('video[data-chatforia-message-video]')
            .forEach((other) => {
              if (other !== current && !other.paused) {
                other.pause();
              }
            });

          void recoverVideo(current);
        }}
        onWaiting={(event) => {
          if (!event.currentTarget.paused) {
            void recoverVideo(event.currentTarget);
          }
        }}
        onLoadedMetadata={(event) => {
          restoreVideoPlayback(event.currentTarget);
        }}
        onError={() => {
          pendingPlaybackRef.current = null;
          setFailedVideoScope(videoScope);
        }}
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
        <Button
          type="button"
          size="xs"
          radius="md"
          variant="light"
          style={{
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--border)',
            boxShadow: 'none',
          }}
          leftSection={<IconRefresh size={15} stroke={2} />}
          onClick={retryVideo}
          mt={8}
        >
          Reload video
        </Button>
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
