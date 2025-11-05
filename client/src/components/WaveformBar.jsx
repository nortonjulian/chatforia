import { useEffect, useRef, useState } from 'react';

export default function WaveformBar({ src, height = 28 }) {
  const canvasRef = useRef(null);
  const [peaks, setPeaks] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(src, { mode: 'cors' });
        const buf = await res.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audio = await ctx.decodeAudioData(buf);
        // compute lightweight peaks
        const channel = audio.getChannelData(0);
        const buckets = 180; // number of bars
        const block = Math.floor(channel.length / buckets);
        const p = new Array(buckets).fill(0).map((_, i) => {
          let sum = 0, start = i * block, end = Math.min((i + 1) * block, channel.length);
          for (let j = start; j < end; j++) sum += Math.abs(channel[j]);
          return sum / (end - start || 1);
        });
        if (alive) setPeaks(p);
        ctx.close();
      } catch {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, [src]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const width = cvs.clientWidth * dpr;
    const h = height * dpr;
    cvs.width = width;
    cvs.height = h;
    const g = cvs.getContext('2d');
    g.clearRect(0, 0, width, h);
    const barW = Math.max(1, Math.floor(width / peaks.length) - 1);
    const max = Math.max(...peaks) || 1;
    for (let i = 0; i < peaks.length; i++) {
      const v = peaks[i] / max;
      const barH = Math.max(2, Math.floor(v * (h - 2)));
      const x = i * (barW + 1);
      const y = Math.floor((h - barH) / 2);
      g.fillRect(x, y, barW, barH);
    }
  }, [peaks, height]);

  return (
    <div style={{ width: 260 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block', opacity: 0.75 }} />
    </div>
  );
}
