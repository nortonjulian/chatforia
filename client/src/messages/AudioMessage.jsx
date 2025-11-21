import { useEffect, useMemo, useState } from 'react';
import TranscriptBubble from '@/components/TranscriptBubble';

/**
 * AudioMessage
 * - Prefers attachments: msg.attachments[].kind === 'AUDIO'
 * - Falls back to legacy: msg.audioUrl
 * - Optional transcription when currentUser?.a11yVoiceNoteSTT is true
 *
 * Expects backend endpoints:
 *  POST /media/:messageId/transcribe  → kicks off STT job (idempotent)
 *  GET  /transcripts/:messageId       → { transcript: { segments: [{ text, ... }, ...] } }
 */
export default function AudioMessage({ msg, currentUser }) {
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(false);

  // Normalize to a list of audio sources
  const audios = useMemo(() => {
    const fromAttachments =
      (msg?.attachments || [])
        .filter((a) => a && (a.kind === 'AUDIO' || a.mimeType?.startsWith('audio/')))
        .map((a) => ({
          url: a.url,
          mimeType: a.mimeType || 'audio/webm',
          durationSec: a.durationSec || null,
          caption: a.caption || '',
          id: a.id || undefined,
        })) || [];

    if (fromAttachments.length > 0) return fromAttachments;

    // Legacy fallback (single)
    if (msg?.audioUrl) {
      return [
        {
          url: msg.audioUrl,
          mimeType: 'audio/webm',
          durationSec: null,
          caption: '',
          id: undefined,
        },
      ];
    }
    return [];
  }, [msg?.attachments, msg?.audioUrl]);

  const canTranscribe = Boolean(
    currentUser?.a11yVoiceNoteSTT && msg?.id && audios.length > 0,
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!canTranscribe) return;
      try {
        setLoading(true);
        // Kick off transcription (idempotent)
        await fetch(`/media/${msg.id}/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // If your server needs attachment urls, add: body: JSON.stringify({ urls: audios.map(a => a.url) })
        }).catch(() => {});

        // Fetch transcript (poll once; your server can return immediately if ready or cached)
        const r = await fetch(`/transcripts/${msg.id}`);
        if (r.ok) {
          const j = await r.json();
          if (alive) setTranscript(j?.transcript || null);
        }
      } catch {
        /* no-op */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [canTranscribe, msg?.id, audios.length]);

  if (audios.length === 0) return null;

  return (
    <div>
      {audios.map((a, i) => (
        <div key={a.id ?? `${a.url}-${i}`} style={{ marginTop: i === 0 ? 0 : 8 }}>
          <audio
            controls
            preload="metadata"
            src={a.url}
            style={{ width: '100%' }}
            aria-label={a.caption ? `Voice note: ${a.caption}` : 'Voice note'}
          />
          {a.caption ? (
            <div className="text-xs text-gray-600 mt-1" aria-hidden="true">
              {a.caption}
            </div>
          ) : null}
        </div>
      ))}

      {canTranscribe ? (
        transcript ? (
          <TranscriptBubble segments={transcript.segments || []} />
        ) : (
          <div className="text-xs text-gray-400 mt-1">
            {'Transcribing…'}
          </div>
        )
      ) : (
        // STT disabled: show static placeholder but do not call fetch
        <div className="text-xs text-gray-400 mt-1">
          {'Transcribing…'}
        </div>
      )}
    </div>
  );
}
