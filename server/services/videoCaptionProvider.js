// Video captions use a separate, audio-only transcription connection. No transcript is stored.
const API = 'https://api.openai.com/v1/realtime';
export function createVideoCaptionProvider({ fetchImpl = fetch, env = process.env } = {}) {
  async function stop(id) {
    if (!/^rtc_[A-Za-z0-9_-]+$/.test(id)) return;
    const response = await fetchImpl(`${API}/calls/${id}/hangup`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok && response.status !== 404) throw new Error('CAPTION_STOP_FAILED');
  }
  return {
    stop,
    async start(sdp) {
      if (!env.OPENAI_API_KEY) throw Object.assign(new Error('Not configured'), { code: 'CAPTIONS_NOT_CONFIGURED' });
      // A transcription-only secret prevents this from becoming an AI voice/chat session.
      // Keep both the permanent and temporary secrets on the server.
      const secretResponse = await fetchImpl(`${API}/client_secrets`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session: {
          type: 'transcription', audio: { input: {
            transcription: { model: 'gpt-4o-transcribe' },
            turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
          } },
        } }),
      });
      if (!secretResponse.ok) throw Object.assign(new Error('Provider unavailable'), { code: 'CAPTION_SESSION_FAILED' });
      const secret = await secretResponse.json();
      if (typeof secret.value !== 'string' || !secret.value) throw new Error('CAPTION_SESSION_FAILED');
      const answer = await fetchImpl(`${API}/calls`, {
        method: 'POST', headers: { Authorization: `Bearer ${secret.value}`, 'Content-Type': 'application/sdp' },
        body: sdp, signal: AbortSignal.timeout(15000),
      });
      if (!answer.ok) throw Object.assign(new Error('Provider unavailable'), { code: 'CAPTION_CONNECTION_FAILED' });
      const location = answer.headers.get('location') || '';
      const id = location.match(/\/calls\/(rtc_[A-Za-z0-9_-]+)$/)?.[1];
      if (!id) throw new Error('CAPTION_CONNECTION_FAILED');
      try {
        const responseSDP = await answer.text();
        if (!responseSDP.startsWith('v=0') || responseSDP.length > 100000) throw new Error('CAPTION_CONNECTION_FAILED');
        return { id, sdp: responseSDP };
      } catch (error) { await stop(id).catch(() => {}); throw error; }
    },
  };
}
