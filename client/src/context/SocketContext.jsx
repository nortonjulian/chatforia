import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from 'react';
import { io } from 'socket.io-client';
import Cookies from 'js-cookie';
import axiosClient from '@/api/axiosClient';

const SocketCtx = createContext(null);

// ---- Config ----
const API_ORIGIN  = import.meta.env.VITE_API_ORIGIN || 'http://localhost:5002';
const SOCKET_PATH = '/socket.io';
const COOKIE_NAME = import.meta.env.VITE_JWT_COOKIE_NAME || 'foria_jwt';

// ---- Auth helpers ----
function readJwt() {
  return (
    Cookies.get(COOKIE_NAME) ||
    localStorage.getItem(COOKIE_NAME) ||
    localStorage.getItem('token') ||
    ''
  );
}
function hasAuth() {
  return Boolean(readJwt() || document.cookie.includes(`${COOKIE_NAME}=`));
}

// ---- Socket factory ----
function makeSocket() {
  const token = readJwt();
  if (import.meta.env.DEV) {
    console.log('[socket] token present?', Boolean(token));
  }

  const socket = io(API_ORIGIN, {
    path: SOCKET_PATH,
    withCredentials: true,
    auth: token ? { token } : undefined,  // preferred (server reads handshake.auth.token)
    // legacy/backup path (server may also accept query.token)
    query: token ? { token } : undefined,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    timeout: 12000,
    transports: ['websocket', 'polling'], // allow fallback if WS blocked
  });

  // diagnostics
  socket.on('connect_error', (err) => {
    console.warn('[socket] connect_error:', err?.message || err);
  });

  return socket;
}

export function SocketProvider({ children, autoJoin = true }) {
  const [socket, setSocket]   = useState(null);
  const [roomIds, setRoomIds] = useState([]);
  const lastTokenRef = useRef(readJwt());

  // Create + connect (only when authenticated)
  const connect = useCallback(() => {
    if (!hasAuth()) return null;
    const s = makeSocket();
    setSocket(s);
    return s;
  }, []);

  const disconnect = useCallback(() => {
    try {
      socket?.disconnect();
    } finally {
      setSocket(null);
    }
  }, [socket]);

  const reconnect = useCallback(() => {
    disconnect();
    return connect();
  }, [connect, disconnect]);

  // Load rooms the current user belongs to (only when authed & connected)
  const refreshRooms = useCallback(async () => {
    if (!hasAuth() || !socket?.connected) {
      setRoomIds([]);
      return [];
    }

    // Try a few known variants; not all backends expose the same route
    const candidates = [
      '/chatrooms/mine?select=id',
      '/rooms/mine?select=id',
      '/rooms?mine=1&select=id',
    ];

    for (const path of candidates) {
      try {
        const { data } = await axiosClient.get(path);
        const items = Array.isArray(data?.items) ? data.items : data;
        const ids   = (items || []).map((r) => String(r.id)).filter(Boolean);
        setRoomIds(ids);
        return ids;
      } catch (e) {
        const status = e?.response?.status;
        if (status === 401) {
          // not logged in – stop trying
          setRoomIds([]);
          return [];
        }
        if (status !== 404) {
          console.warn('[socket] failed to load my rooms:', e?.message || e);
        }
        // 404 → try next candidate
      }
    }

    // No “mine” route exists → just no-op
    setRoomIds([]);
    return [];
  }, [socket]);

  // Mount: only connect if there’s auth (prevents 404 spam before login)
  useEffect(() => {
    if (!hasAuth()) return;
    const s = connect();
    return () => { try { s?.disconnect(); } catch {} };
  }, [connect]);

  // Auto-join rooms after connect or when the room list changes
  useEffect(() => {
    if (!socket) return;

    const onConnected = async () => {
      if (!autoJoin) return;
      const ids = roomIds.length ? roomIds : await refreshRooms();
      if (ids.length) {
        try {
          socket.emit('join:rooms', ids);
          if (import.meta.env.DEV) console.log('[socket] joined rooms:', ids);
        } catch (e) {
          console.warn('[socket] join:rooms error', e?.message || e);
        }
      }
    };

    if (socket.connected) onConnected();
    socket.on('connect', onConnected);
    return () => { socket.off('connect', onConnected); };
  }, [socket, roomIds, autoJoin, refreshRooms]);

  // If token changes (login/logout), reconnect with new auth
  useEffect(() => {
    const handleStorage = (e) => {
      if (!e) return;
      const keys = [COOKIE_NAME, 'token'];
      if (keys.includes(e.key)) {
        if (import.meta.env.DEV) console.log('[socket] token changed (storage); reconnecting');
        lastTokenRef.current = readJwt();
        reconnect();
      }
    };
    window.addEventListener('storage', handleStorage);

    // Also detect cookie-only changes (storage doesn't fire for cookies)
    const cookiePoll = setInterval(() => {
      const now = readJwt();
      if (now !== lastTokenRef.current) {
        if (import.meta.env.DEV) console.log('[socket] token changed (cookie); reconnecting');
        lastTokenRef.current = now;
        reconnect();
      }
    }, 2000);

    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(cookiePoll);
    };
  }, [reconnect]);

  // Convenience passthroughs so consumers don't have to reach into socket directly
  const on = useCallback((event, handler) => socket?.on?.(event, handler), [socket]);
  const off = useCallback((event, handler) => socket?.off?.(event, handler), [socket]);
  const once = useCallback((event, handler) => socket?.once?.(event, handler), [socket]);
  const emit = useCallback((event, payload) => socket?.emit?.(event, payload), [socket]);

  const value = useMemo(
    () => ({
      // raw socket for advanced usages
      socket,

      // lifecycle
      connect,
      disconnect,
      reconnect,

      // room management
      refreshRooms,
      setRoomIds,
      joinRooms: (ids) => socket?.emit?.('join:rooms', (ids || []).map(String)),
      leaveRoom: (id) => socket?.emit?.('leave_room', String(id)),

      // event helpers
      on, off, once, emit,
    }),
    [socket, connect, disconnect, reconnect, refreshRooms, on, off, once, emit]
  );

  return <SocketCtx.Provider value={value}>{children}</SocketCtx.Provider>;
}

export function useSocket() {
  return useContext(SocketCtx);
}

/**
 * Optional convenience hook if you prefer the raw socket instance directly.
 * Example:
 *   const socket = useSocketRaw();
 *   useEffect(() => { socket?.on('status:posted', ...); }, [socket]);
 */
export function useSocketRaw() {
  return useContext(SocketCtx)?.socket ?? null;
}
