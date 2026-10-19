// Captions never own the original call tracks or the Twilio connection.
export function createVideoCaptionReceiver(onText) {
  const items = new Map(), events = new Set();
  let sequence = 0, displayed = 0, disposed = false;
  return {
    receive(raw) {
      if (disposed || typeof raw !== 'string' || raw.length > 20000) return;
      let event;
      try { event = JSON.parse(raw); } catch { return; }
      if (typeof event?.item_id !== 'string' || event.item_id.length > 200) return;
      if (event.event_id) {
        if (events.has(event.event_id)) return;
        events.add(event.event_id);
        if (events.size > 256) events.delete(events.values().next().value);
      }
      const partial = event.type === 'conversation.item.input_audio_transcription.delta';
      const final = event.type === 'conversation.item.input_audio_transcription.completed';
      const boundary = ['input_audio_buffer.speech_started', 'input_audio_buffer.committed'].includes(event.type);
      if (!partial && !final && !boundary) return;
      if (!items.has(event.item_id)) {
        items.set(event.item_id, { order: ++sequence, text: '', final: false });
        if (items.size > 128) items.delete(items.keys().next().value);
      }
      const item = items.get(event.item_id);
      if (boundary || item.order < displayed || (item.final && partial)) return;
      const value = final ? event.transcript : event.delta;
      if (typeof value !== 'string') return;
      item.text = (final ? value : item.text + value).slice(0, 4000);
      item.final = final;
      if (!item.text.trim()) return;
      displayed = item.order;
      onText(item.text.trim());
    },
    dispose() { disposed = true; items.clear(); events.clear(); },
  };
}

async function captionAudio(tracks, env) {
  const copies = [];
  let context, output;
  const cleanup = () => {
    copies.forEach(track => track.stop());
    output?.getTracks().forEach(track => track.stop());
    context?.close().catch(() => {});
  };
  try {
    tracks.forEach(track => copies.push(track.clone()));
    if (copies.length === 1) return { track: copies[0], cleanup };
    // Mix only remote participants if a call contains more than one remote audio track.
    const AudioContext = env.AudioContext || env.webkitAudioContext;
    if (!AudioContext) throw new Error('Audio mixing unavailable');
    context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    output = destination.stream;
    copies.forEach(track => context.createMediaStreamSource(new env.MediaStream([track])).connect(destination));
    let timer;
    try {
      await Promise.race([context.resume(), new Promise((_, reject) => {
        timer = env.setTimeout(() => reject(new Error('Audio mixing unavailable')), 4000);
      })]);
    } finally { env.clearTimeout(timer); }
    if (context.state === 'suspended') throw new Error('Audio mixing suspended');
    return { track: output.getAudioTracks()[0], cleanup };
  } catch (error) { cleanup(); throw error; }
}

export function observeVideoCaptions({ api, callId, remoteStream, onText, onStatus, env = globalThis }) {
  let disposed = false, signature = '', connection, blocked = false;
  function close(current) {
    if (!current) return Promise.resolve();
    if (current.closed) return current.closing || Promise.resolve();
    current.closed = true;
    current.controller.abort();
    env.clearInterval(current.leaseTimer);
    env.clearTimeout(current.readyTimer);
    current.receiver.dispose();
    current.channel?.close();
    current.peer?.close();
    current.audio?.cleanup();
    current.closing = current.requested ? api.delete(current.path).catch(() => {}) : Promise.resolve();
    return current.closing;
  }
  function fail(current) {
    if (disposed || current !== connection || current.closed) return;
    blocked = true;
    close(current);
    onText('');
    onStatus('error');
  }
  async function connect(tracks) {
    if (!env.crypto?.randomUUID || !env.RTCPeerConnection) { blocked = true; onStatus('error'); return; }
    const current = { controller: new AbortController(), closed: false,
      path: `/video/${callId}/captions/${env.crypto.randomUUID()}`,
      receiver: createVideoCaptionReceiver(text => { if (!disposed && !current.closed && current === connection) { onStatus('ready'); onText(text); } }),
    };
    connection = current;
    try {
      onStatus('connecting');
      current.audio = await captionAudio(tracks, env);
      if (disposed || current.closed) { current.audio.cleanup(); return; }
      current.peer = new env.RTCPeerConnection();
      current.peer.addTransceiver(current.audio.track, { direction: 'sendonly' });
      current.channel = current.peer.createDataChannel('oai-events');
      current.channel.onmessage = ({ data }) => {
        if (current.closed || disposed) return;
        let event;
        try { event = JSON.parse(data); } catch { return; }
        if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') { fail(current); return; }
        current.receiver.receive(data);
      };
      current.channel.onopen = () => { env.clearTimeout(current.readyTimer); if (!disposed && !current.closed) onStatus('ready'); };
      current.channel.onclose = () => fail(current);
      current.channel.onerror = () => fail(current);
      current.peer.onconnectionstatechange = () => {
        if (['failed', 'disconnected'].includes(current.peer.connectionState)) fail(current);
      };
      const offer = await current.peer.createOffer();
      await current.peer.setLocalDescription(offer);
      if (disposed || current.closed) return;
      current.requested = true;
      const { data } = await api.post(current.path, { sdp: offer.sdp }, { signal: current.controller.signal, timeout: 35000 });
      if (disposed || current.closed) { api.delete(current.path).catch(() => {}); return; }
      if (typeof data?.sdp !== 'string' || !data.sdp.startsWith('v=0')) throw new Error('Invalid caption connection');
      await current.peer.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      if (disposed || current.closed) return;
      if (current.channel.readyState !== 'open') current.readyTimer = env.setTimeout(() => fail(current), 15000);
      current.leaseTimer = env.setInterval(async () => {
        if (current.closed || current.leasing) return;
        current.leasing = true;
        try {
          const response = await api.post(`${current.path}/lease`, {}, { signal: current.controller.signal, timeout: 8000 });
          if (response?.data?.reconnect && !current.closed && !disposed) {
            close(current);
            signature = '';
            onText('');
            onStatus('connecting');
          }
        }
        catch { fail(current); }
        finally { current.leasing = false; }
      }, 5000);
    } catch { fail(current); }
  }
  function sync() {
    if (disposed || blocked) return;
    const tracks = (remoteStream?.current?.getAudioTracks?.() || []).filter(t => t.readyState === 'live');
    const next = tracks.map(t => t.id).sort().join(':');
    if (next === signature) return;
    signature = next;
    const closing = close(connection);
    onText('');
    if (tracks.length) {
      closing.then(() => { if (!disposed && !blocked && signature === next) connect(tracks); });
    } else onStatus('waiting');
  }
  // React's development effect probe can dispose the first observer before capture starts.
  const timer = env.setInterval(sync, 500);
  return () => { disposed = true; env.clearInterval(timer); close(connection); };
}
