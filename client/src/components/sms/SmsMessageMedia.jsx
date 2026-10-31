import { useEffect, useRef, useState } from 'react';
import axiosClient from '@/api/axiosClient';
import { smsMediaKind } from '@/utils/smsMediaKind';

// Fetch with the normal authenticated API client, then play a local Blob URL.
// This supports cookie and bearer sessions without exposing either in a URL.
export default function SmsMessageMedia({ messageId, mediaIndex, item, accountKey, onOpenImage }) {
  const [media, setMedia] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const element = useRef(null);
  const scope = `${accountKey}:${messageId}:${mediaIndex}:${typeof item === 'string' ? item : item?.url}`;
  useEffect(() => {
    let alive = true, objectURL;
    const controller = new AbortController();
    setMedia(null); setFailed(false);
    axiosClient.get(`/sms/media/${messageId}/${mediaIndex}`, { responseType: 'blob', signal: controller.signal })
      .then(response => {
        if (!alive) return;
        const type = response.headers?.['content-type'] || response.data?.type || '';
        const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type });
        objectURL = URL.createObjectURL(blob);
        setMedia({ scope, url: objectURL, kind: smsMediaKind(item, type) });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false; controller.abort();
      element.current?.pause?.();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [scope, attempt]); // item identity alone must not refetch on every thread refresh

  if (failed) return (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, maxWidth: '100%', padding: '6px 2px' }}>
      <span style={{ fontSize: 13, lineHeight: 1.4 }}>Couldn't load attachment.</span>
      <button
        type="button"
        onClick={() => setAttempt(value => value + 1)}
        style={{
          appearance: 'none',
          border: '1px solid currentColor',
          background: 'transparent',
          color: 'inherit',
          borderRadius: 999,
          padding: '5px 12px',
          font: 'inherit',
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.4,
          cursor: 'pointer',
        }}
      >
        Retry loading
      </button>
    </div>
  );
  if (!media || media.scope !== scope) return <span role="status">Loading attachment…</span>;
  const onlyThisSMSAudio = event => {
    document.querySelectorAll('audio[data-sms-audio]').forEach(audio => { if (audio !== event.currentTarget) audio.pause(); });
  };
  if (media.kind === 'audio') return <audio ref={element} data-sms-audio controls preload="metadata" src={media.url} aria-label="Voice message" onPlay={onlyThisSMSAudio} onError={() => setFailed(true)} style={{ maxWidth: '100%', width: 280 }} />;
  if (media.kind === 'video') return <video ref={element} controls preload="metadata" src={media.url} aria-label="Video attachment" onError={() => setFailed(true)} style={{ maxWidth: '100%', width: 240 }} />;
  if (media.kind === 'image') return <img src={media.url} alt="MMS attachment" onError={() => setFailed(true)} onClick={onOpenImage} style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 12, cursor: 'pointer' }} />;
  return <a href={media.url} download="attachment">Download attachment</a>;
}
