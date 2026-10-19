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
  const copies = [], sources = [];
  let context, output;
  const cleanup = () => {
    sources.forEach(source => source.disconnect());
    copies.forEach(track => track.stop());
    output?.getTracks().forEach(track => track.stop());
    context?.close().catch(() => {});
  };
  try {
    tracks.forEach(track => copies.push(track.clone()));
    // A received WebRTC track can be live and unmuted yet send zero RTP when
    // forwarded directly to another peer connection. Always create a local
    // Web Audio output, even for one caller, so the caption sender encodes PCM.
    // This graph never connects to speakers or owns the original call tracks.
    const AudioContext = env.AudioContext || env.webkitAudioContext;
    if (!AudioContext) throw new Error('Audio mixing unavailable');
    context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    output = destination.stream;
    copies.forEach(track => {
      const source = context.createMediaStreamSource(new env.MediaStream([track]));
      sources.push(source);
      source.connect(destination);
    });
    let timer;
    try {
      await Promise.race([context.resume(), new Promise((_, reject) => {
        timer = env.setTimeout(() => reject(new Error('Audio mixing unavailable')), 4000);
      })]);
    } finally { env.clearTimeout(timer); }
    if (context.state !== 'running') throw new Error('Caption audio is not running');
    const track = output.getAudioTracks()[0];
    if (!track) throw new Error('Caption audio output unavailable');
    return { track, cleanup };
  } catch (error) { cleanup(); throw error; }
}

export function observeVideoCaptions({ api, callId, remoteStream, onText, onStatus, env = globalThis }) {
  let disposed = false, connection, selected = [], opening;
  let terminal = false, retryTimer, failures = 0;
  const cleanupPaths = new Set(), cleanups = new Map();
  const online = () => env.navigator?.onLine !== false;
  const retryable = error => {
    const status = Number(error?.response?.status || 0);
    return !status || [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
  };

  // Retain failed cleanup until connectivity returns. Never delete another
  // browser's session or wait indefinitely for a lost DELETE response.
  function release(path) {
    if (cleanups.has(path)) return cleanups.get(path);
    if (!online()) return Promise.resolve();
    const controller = new AbortController();
    const pending = new Promise(resolve => {
      let done = false, timer;
      const finish = ok => {
        if (done) return;
        done = true;
        env.clearTimeout(timer);
        if (ok) cleanupPaths.delete(path);
        resolve();
      };
      timer = env.setTimeout(() => { controller.abort(); finish(false); }, 8000);
      try {
        Promise.resolve(api.delete(path, { signal: controller.signal, timeout: 8000 }))
          .then(() => finish(true), () => finish(false));
      } catch { finish(false); }
    });
    cleanups.set(path, pending);
    pending.then(() => cleanups.delete(path));
    return pending;
  }
  function close(current) {
    if (!current || current.closed) return;
    current.closed = true;
    current.controller.abort();
    env.clearInterval(current.leaseTimer);
    env.clearTimeout(current.readyTimer);
    current.receiver.dispose();
    current.channel?.close();
    current.peer?.close();
    current.audio?.cleanup();
    if (current.requested) { cleanupPaths.add(current.path); release(current.path); }
  }
  function fail(current, canRetry = false) {
    if (disposed || current !== connection || current.closed) return;
    close(current);
    selected = [];
    onText('');
    terminal = !canRetry;
    if (terminal || ++failures > 6) {
      terminal = true;
      onStatus('error');
      return;
    }
    onStatus('reconnecting');
    if (online()) {
      retryTimer = env.setTimeout(() => {
        retryTimer = undefined;
        sync();
      }, Math.min(1000 * 2 ** (failures - 1), 8000));
    }
  }
  async function connect(tracks) {
    if (!env.crypto?.randomUUID || !env.RTCPeerConnection) { terminal = true; onStatus('error'); return; }
    const current = { controller: new AbortController(), closed: false,
      path: `/video/${callId}/captions/${env.crypto.randomUUID()}`,
      receiver: createVideoCaptionReceiver(text => {
        if (!disposed && !current.closed && current === connection) {
          failures = 0; onStatus('ready'); onText(text);
        }
      }),
    };
    opening = current;
    connection = current;
    try {
      onStatus(failures ? 'reconnecting' : 'connecting');
      await Promise.all([...cleanupPaths].map(release));
      if (disposed || current.closed) return;
      if (!online()) { close(current); selected = []; onStatus('reconnecting'); return; }
      current.audio = await captionAudio(tracks, env);
      if (disposed || current.closed) { current.audio.cleanup(); return; }
      current.peer = new env.RTCPeerConnection();
      // Retain the working transcription-only audio negotiation. Never attach
      // the caption receiver to a player or acquire the local microphone.
      current.peer.addTransceiver(current.audio.track, { direction: 'sendrecv' });
      current.channel = current.peer.createDataChannel('oai-events');
      current.channel.onmessage = ({ data }) => {
        if (current.closed || disposed || current !== connection) return;
        let event;
        try { event = JSON.parse(data); } catch { return; }
        if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') { fail(current); return; }
        current.receiver.receive(data);
      };
      current.channel.onopen = () => {
        env.clearTimeout(current.readyTimer);
        if (!disposed && !current.closed && current === connection) onStatus('ready');
      };
      current.channel.onclose = () => fail(current, true);
      current.channel.onerror = () => fail(current, true);
      current.peer.onconnectionstatechange = () => {
        if (['failed', 'disconnected'].includes(current.peer.connectionState)) fail(current, true);
      };
      const offer = await current.peer.createOffer();
      await current.peer.setLocalDescription(offer);
      if (disposed || current.closed) return;
      current.requested = true;
      let response;
      try {
        response = await api.post(current.path, { sdp: offer.sdp }, { signal: current.controller.signal, timeout: 35000 });
      } catch (error) { fail(current, retryable(error)); return; }
      const { data } = response;
      if (disposed || current.closed) {
        // A setup response may arrive after cancellation. Delete that exact
        // session again; it must never render text or replace the new attempt.
        cleanupPaths.add(current.path); release(current.path); return;
      }
      if (typeof data?.sdp !== 'string' || !data.sdp.startsWith('v=0')) throw new Error('Invalid caption connection');
      await current.peer.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      if (disposed || current.closed) return;
      const canSendAudio = current.peer.getTransceivers().some(t =>
        t.sender.track === current.audio.track &&
        ['sendonly', 'sendrecv'].includes(t.currentDirection));
      if (!canSendAudio) { fail(current); return; }
      if (current.channel.readyState !== 'open') current.readyTimer = env.setTimeout(() => fail(current, true), 15000);
      current.leaseTimer = env.setInterval(async () => {
        if (current.closed || current.leasing) return;
        current.leasing = true;
        try {
          const response = await api.post(`${current.path}/lease`, {}, { signal: current.controller.signal, timeout: 8000 });
          if (response?.data?.reconnect && !current.closed && !disposed) {
            close(current); selected = []; onText(''); onStatus('reconnecting');
          }
        }
        catch (error) { fail(current, retryable(error)); }
        finally { current.leasing = false; }
      }, 5000);
    } catch { fail(current); }
    finally { if (opening === current) opening = null; }
  }
  function sync() {
    if (disposed || terminal || retryTimer || (opening && !opening.closed) || !online()) return;
    const tracks = (remoteStream?.current?.getAudioTracks?.() || [])
      .filter(t => t.readyState === 'live' && t.muted !== true);
    // Object identity matters: a recovered remote track may reuse its old ID.
    const same = tracks.length === selected.length && tracks.every(t => selected.includes(t));
    if (same && ((!tracks.length) || (connection && !connection.closed))) return;
    close(connection);
    selected = tracks;
    onText('');
    if (tracks.length) connect(tracks);
    else onStatus('waiting');
  }
  function offline() {
    if (disposed || terminal) return;
    env.clearTimeout(retryTimer); retryTimer = undefined;
    close(connection); selected = []; onText(''); onStatus('reconnecting');
  }
  function resume() {
    if (disposed || terminal || !online()) return;
    env.clearTimeout(retryTimer); retryTimer = undefined;
    sync();
  }
  function retry() {
    if (disposed) return;
    terminal = false; failures = 0;
    env.clearTimeout(retryTimer); retryTimer = undefined;
    close(connection); selected = []; onText('');
    onStatus(online() ? 'connecting' : 'reconnecting');
    sync();
  }
  const timer = env.setInterval(sync, 500);
  env.addEventListener?.('offline', offline);
  env.addEventListener?.('online', resume);
  env.addEventListener?.('focus', resume);
  const stop = () => {
    disposed = true;
    env.clearInterval(timer); env.clearTimeout(retryTimer);
    env.removeEventListener?.('offline', offline);
    env.removeEventListener?.('online', resume);
    env.removeEventListener?.('focus', resume);
    close(connection);
  };
  stop.retry = retry;
  return stop;
}
