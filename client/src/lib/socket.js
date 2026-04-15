import { io } from 'socket.io-client';
import { WS_URL } from '@/config';

const socket = io(WS_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  withCredentials: true,
});

export function connectSocket(token) {
  if (!token) return;

  const nextToken = String(token).trim();
  const currentToken = socket.auth?.token ? String(socket.auth.token).trim() : '';

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