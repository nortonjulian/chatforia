// Receive only the active call's ephemeral captions. Never persist speech text.
export function subscribeCallCaptions({ socket, callId, onText }) {
  const id = Number(callId);
  if (!socket?.on || !Number.isSafeInteger(id) || id <= 0) return () => {};
  let disposed = false;
  let previous = '';
  const receive = (event) => {
    if (disposed || Number(event?.callId) !== id || typeof event?.text !== 'string') return;
    // This Twilio callback is on the caller leg: outbound is the callee's own speech.
    if (event.track === 'outbound_track') return;
    const text = event.text.trim().slice(0, 4000);
    if (!text || text === previous) return;
    previous = text;
    // Replace the displayed segment so partials do not duplicate final text.
    onText(text);
  };
  socket.on('call:caption', receive);
  return () => {
    disposed = true;
    socket.off('call:caption', receive);
  };
}

export function captionAppearance(font, background) {
  const size = { sm: '0.875rem', md: '1rem', lg: '1.25rem', xl: '1.5rem' }[font] || '1.25rem';
  const colors = background === 'light'
    ? { background: 'rgba(255, 255, 255, 0.95)', color: '#111', textShadow: 'none' }
    : background === 'transparent'
      ? { background: 'transparent', color: '#fff', textShadow: '0 1px 3px #000, 0 0 4px #000' }
      : { background: 'rgba(0, 0, 0, 0.85)', color: '#fff', textShadow: 'none' };
  return { fontSize: size, ...colors };
}
