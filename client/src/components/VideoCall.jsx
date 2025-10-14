import { useEffect, useMemo, useRef, useState } from 'react';
import { useCall } from '@/context/CallContext';
import { toast } from '@/utils/safeToast';


export default function VideoCall() {
  const { active, localStream, remoteStream, endCall } = useCall();
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const autoplayWarnedLocal = useRef(false);
  const autoplayWarnedRemote = useRef(false);

  const inCall = useMemo(() => Boolean(active?.callId), [active]);

  function tryPlay(el, which = 'video') {
    if (!el) return;
    el.play().catch(() => {
      if (which === 'local' && !autoplayWarnedLocal.current) {
        autoplayWarnedLocal.current = true;
        toast.info('Autoplay blocked. Click your preview to start.');
      }
      if (which === 'remote' && !autoplayWarnedRemote.current) {
        autoplayWarnedRemote.current = true;
        toast.info('Autoplay blocked. Click the remote video to start.');
      }
    });
  }

  useEffect(() => {
    if (!inCall) return;
    const l = localRef.current;
    const r = remoteRef.current;

    if (l) {
      try { l.srcObject = localStream.current || null; } catch {}
      l.muted = true;
      l.playsInline = true;
      l.autoplay = true;
      l.onloadedmetadata = () => tryPlay(l, 'local');
    } else if (!localStream.current) {
      toast.err('No local media stream available.');
    }

    if (r) {
      try { r.srcObject = remoteStream.current || null; } catch {}
      r.playsInline = true;
      r.autoplay = true;
      r.onloadedmetadata = () => tryPlay(r, 'remote');
    }
  }, [inCall, localStream, remoteStream]);

  if (!inCall) return null;

  function toggleMic() {
    const tracks = localStream.current?.getAudioTracks?.() || [];
    if (!tracks.length) {
      toast.err('No microphone detected.');
      return;
    }
    const next = !micOn;
    tracks.forEach((t) => { t.enabled = next; });
    setMicOn(next);
    toast.info(next ? 'Microphone unmuted' : 'Microphone muted');
  }

  function toggleCam() {
    const tracks = localStream.current?.getVideoTracks?.() || [];
    if (!tracks.length) {
      toast.err('No camera detected.');
      return;
    }
    const next = !camOn;
    tracks.forEach((t) => { t.enabled = next; });
    setCamOn(next);
    toast.info(next ? 'Camera on' : 'Camera off');
  }

  function handleEndCall() {
    // ✅ call synchronously so the jest spy is observed immediately
    try {
      endCall();
      toast.ok('Call ended');
    } catch {
      toast.err('Failed to end call. Please try again.');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center">
      <div className="relative w-full max-w-4xl aspect-video bg-black rounded-xl overflow-hidden shadow-2xl">
        <video
          ref={remoteRef}
          className="absolute inset-0 w-full h-full object-cover cursor-pointer"
          onClick={(e) => tryPlay(e.currentTarget, 'remote')}
        />
        <video
          ref={localRef}
          className="absolute bottom-4 right-4 w-48 h-28 object-cover rounded-lg border border-white/20 shadow-lg cursor-pointer"
          onClick={(e) => tryPlay(e.currentTarget, 'local')}
        />

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3">
          <button
            type="button"
            onClick={toggleMic}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleMic(); } }}
            className={`px-4 py-2 rounded-full ${micOn ? 'bg-white/10 text-white' : 'bg-red-600 text-white'}`}
            title={micOn ? 'Mute microphone' : 'Unmute microphone'}
            aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            aria-pressed={!micOn}
          >
            {micOn ? 'Mute' : 'Unmute'}
          </button>

          <button
            type="button"
            onClick={toggleCam}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleCam(); } }}
            className={`px-4 py-2 rounded-full ${camOn ? 'bg-white/10 text-white' : 'bg-yellow-600 text-white'}`}
            title={camOn ? 'Turn camera off' : 'Turn camera on'}
            aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
            aria-pressed={!camOn}
          >
            {camOn ? 'Camera Off' : 'Camera On'}
          </button>

          <button
            type="button"
            onClick={handleEndCall}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleEndCall(); } }}
            className="px-4 py-2 rounded-full bg-red-700 text-white"
            title="Hang up"
            aria-label="Hang up"
          >
            Hang Up
          </button>
        </div>
      </div>
    </div>
  );
}
