import { connect } from 'twilio-video';

export async function joinRoom({ identity, room }) {
  const res = await fetch('/api/video/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ identity, room }),
  });

  // Better error handling for non-2xx
  if (!res.ok) {
    let bodyText = '';
    try { bodyText = await res.text(); } catch {}
    throw new Error(`[video] token endpoint failed ${res.status}: ${bodyText || 'no body'}`);
  }

  let token;
  try {
    const data = await res.json();
    token = data?.token;
  } catch {
    throw new Error('[video] token endpoint returned non-JSON or empty body');
  }

  if (!token) throw new Error('Failed to get Video Access Token');

  return connect(token, {
    audio: true,
    video: { width: 1280, height: 720 },
  });
}
