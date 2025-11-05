import { useCallback, useEffect, useRef, useState } from 'react';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4', // limited support (Safari)
];

function pickMime() {
  for (const t of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

export default function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [permission, setPermission] = useState(null); // 'granted' | 'denied' | null
  const [durationMs, setDurationMs] = useState(0);
  const [mimeType] = useState(pickMime);

  const mediaRef = useRef(null);     // MediaStream
  const recRef = useRef(null);       // MediaRecorder
  const chunksRef = useRef([]);
  const t0Ref = useRef(0);
  const rafRef = useRef(null);

  const tick = () => {
    setDurationMs(Date.now() - t0Ref.current);
    rafRef.current = requestAnimationFrame(tick);
  };

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermission('granted');
      mediaRef.current = stream;
      return true;
    } catch {
      setPermission('denied');
      return false;
    }
  }, []);

  const start = useCallback(async () => {
    if (!mediaRef.current) {
      const ok = await requestPermission();
      if (!ok) throw new Error('Mic permission denied');
    }
    chunksRef.current = [];
    const rec = new MediaRecorder(mediaRef.current, mimeType ? { mimeType } : undefined);
    recRef.current = rec;

    await new Promise((res) => {
      rec.onstart = res;
      rec.start(250); // timeslice for chunks
    });

    t0Ref.current = Date.now();
    setDurationMs(0);
    setRecording(true);
    rafRef.current = requestAnimationFrame(tick);

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
  }, [mimeType, requestPermission]);

  const stop = useCallback(async () => {
    if (!recRef.current) return null;
    await new Promise((res) => {
      recRef.current.onstop = res;
      recRef.current.stop();
    });
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setRecording(false);
    const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
    const duration = Date.now() - t0Ref.current;
    return { blob, durationMs: duration, mimeType: blob.type };
  }, [mimeType]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      mediaRef.current?.getTracks()?.forEach(t => t.stop());
    };
  }, []);

  return { recording, permission, durationMs, start, stop, requestPermission };
}
