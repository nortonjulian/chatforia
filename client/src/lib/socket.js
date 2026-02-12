import { io } from 'socket.io-client';

function toWs(url) {
  if (!url) return '';
  // If they already provided ws/wss, keep it.
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  // Convert http/https to ws/wss
  return url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

// ✅ Canonical:
// - VITE_WS_URL for sockets
// - fallback: derive from VITE_API_BASE_URL
// - temporary legacy fallbacks (remove later): VITE_SOCKET_URL, VITE_API_URL
const raw =
  import.meta.env.VITE_WS_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_SOCKET_URL || // ⚠️ legacy
  import.meta.env.VITE_API_URL ||    // ⚠️ legacy
  'http://localhost:5002';

const URL = toWs(raw);

// Create a single shared client
const socket = io(URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  withCredentials: true,
});

// Optional logging (dev only)
if (import.meta.env.DEV) {
  socket.on('connect', () => console.debug('[socket] connected', socket.id));
  socket.on('disconnect', (reason) => console.debug('[socket] disconnected', reason));
  socket.on('connect_error', (err) => console.warn('[socket] connect_error', err?.message));
}

export default socket;
