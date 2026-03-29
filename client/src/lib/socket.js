import { io } from 'socket.io-client';

function toWs(url) {
  if (!url) return '';
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  return url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

const raw =
  import.meta.env.VITE_WS_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:5002';

const URL = toWs(raw);

const socket = io(URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  withCredentials: true,
});

export function connectSocket(token) {
  if (!token) return;

  const nextToken = String(token).trim();
  const currentToken = socket.auth?.token ? String(socket.auth.token).trim() : '';

  // no-op if already connected with same token
  if (socket.connected && currentToken === nextToken) return;

  if (socket.connected || socket.active) {
    socket.disconnect();
  }

  socket.auth = { token: nextToken };
  socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
  socket.auth = {};
}

export default socket;

if (import.meta.env.DEV) {
  socket.on('connect', () => console.debug('[socket] connected', socket.id));
  socket.on('disconnect', (reason) => console.debug('[socket] disconnected', reason));
  socket.on('connect_error', (err) => console.warn('[socket] connect_error', err?.message));
}