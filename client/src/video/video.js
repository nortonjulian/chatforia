import { connect } from 'twilio-video';

export async function joinRoom({ identity, room }) {
  const r = await fetch('/tokens/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ identity, room }),
  });
  const { token } = await r.json();
  if (!token) throw new Error('Failed to get Video Access Token');

  return connect(token, {
    audio: true,
    video: { width: 1280, height: 720 }, // tune as needed
  });
}
