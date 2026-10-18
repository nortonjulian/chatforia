import { useEffect, useState } from 'react';
import axiosClient from '../../api/axiosClient';

export default function VoiceNoteTranscript({ msg, currentUser }) {
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const messageId = Number(msg?.id);
  const enabled = currentUser?.a11yVoiceNoteSTT === true && Boolean(currentUser?.id) &&
    Number.isSafeInteger(messageId) && messageId > 0;
  const scope = `${currentUser?.id}:${messageId}:${msg?.revision || ''}:${msg?.editedAt || ''}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    setResult({ scope, status: 'loading' });
    axiosClient.post(`/media/${messageId}/transcribe`, {}, { signal: controller.signal, timeout: 90000 })
      .then(({ data }) => {
        if (!active) return;
        const segments = data?.transcript?.segments;
        if (!Array.isArray(segments)) throw new Error('Missing transcript');
        setResult({ scope, status: 'ready', text: segments.map(s => String(s?.text || '')).join(' ').trim() });
      })
      .catch(error => {
        if (active) setResult({ scope, status: 'error', code: error?.response?.data?.code });
      });
    return () => { active = false; controller.abort(); };
  }, [enabled, scope, messageId, retry]);

  // A late response from another account, message revision, or disabled preference cannot render.
  if (!enabled || result?.scope !== scope) return null;
  if (result.status === 'loading') return <div role="status">Transcribing…</div>;
  if (result.status === 'error') {
    const reason = result.code === 'PREMIUM_REQUIRED' ? 'Transcription in this language requires Premium.' :
      result.code === 'TRANSCRIPTION_QUOTA_EXCEEDED' ? 'Your voice-note transcription allowance has been used.' :
        'Voice-note transcription is unavailable.';
    return <div role="status">{reason} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry transcription</button></div>;
  }
  return <div aria-label="Voice-note transcript" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>
    {result.text || 'No speech detected.'}
  </div>;
}
