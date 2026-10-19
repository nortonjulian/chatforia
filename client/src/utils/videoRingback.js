import { startVideoRingtone } from './videoRingtone.js';

let ringbackUrl;

// Local waiting tone only: never attach it to a microphone, call track, or captions.
// A 440/480 Hz pair for two seconds followed by four seconds of silence.
export function videoRingbackUrl() {
  if (ringbackUrl) return ringbackUrl;
  const rate = 8000, samples = rate * 6;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset, text) => [...text].forEach((c, i) => { bytes[offset + i] = c.charCodeAt(0); });
  label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < rate * 2; i++) {
    const time = i / rate;
    const envelope = Math.min(1, time / 0.005, (2 - time) / 0.005);
    const value = 0.18 * envelope * (Math.sin(2 * Math.PI * 440 * time) + Math.sin(2 * Math.PI * 480 * time));
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  // Chunk to avoid spreading a large array onto the JavaScript call stack.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  ringbackUrl = `data:audio/wav;base64,${btoa(binary)}`;
  return ringbackUrl;
}

export function startVideoRingback(options = {}) {
  return startVideoRingtone({ ...options, src: videoRingbackUrl() });
}
