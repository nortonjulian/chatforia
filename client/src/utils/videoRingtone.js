// Owns only the incoming video ringtone, never the call's media or Voice SDK.
export function startVideoRingtone({ src, volume = 0.7, onStatus = () => {}, AudioImpl = globalThis.Audio }) {
  let audio, stopped = false, pending = false;
  const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.7;
  const silence = () => {
    try { audio?.pause(); if (audio) audio.currentTime = 0; } catch {}
  };
  function failed(error) {
    pending = false;
    if (!stopped) onStatus(error?.name === 'NotAllowedError' ? 'blocked' : 'error');
  }
  function retry() {
    if (stopped || pending || level === 0) return;
    pending = true;
    try {
      if (!audio) {
        audio = new AudioImpl(src);
        audio.volume = level;
        audio.loop = true;
      }
      Promise.resolve(audio.play()).then(() => {
        pending = false;
        if (stopped) { silence(); return; }
        onStatus('playing');
      }, failed);
    } catch (error) { failed(error); }
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    silence();
    try { audio?.removeAttribute('src'); audio?.load(); } catch {}
  }
  if (level > 0) retry();
  return { stop, retry };
}
