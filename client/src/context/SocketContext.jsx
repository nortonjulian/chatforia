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
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || 'http://localhost:5002';
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

function getSocketOptions() {
  const token = readJwt();

  const options = {
    path: SOCKET_PATH,
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    timeout: 12000,
    transports: ['websocket', 'polling'],
  };

  if (token) {
    options.auth = { token };
  }

  return options;
}

function attachDebugListeners(socket) {
  if (!socket || !import.meta.env.DEV) return;

  socket.on('connect', () => {
    console.log('[socket] connected →', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[socket] disconnected →', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[socket] connect_error:', err?.message || err);
  });
}

function createSocket() {
  const socket = io(API_ORIGIN, getSocketOptions());
  attachDebugListeners(socket);
  return socket;
}

function normalizeRoomArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rooms)) return data.rooms;
  if (Array.isArray(data?.chatrooms)) return data.chatrooms;
  if (Array.isArray(data?.data)) return data.data;
  return null;
}

function toRoomIds(rows) {
  return (rows || [])
    .map((r) => String(r?.id ?? r?.chatRoomId ?? r?.roomId ?? ''))
    .filter(Boolean);
}

export function SocketProvider({ children, autoJoin = true }) {
  const [socket, setSocket] = useState(null);
  const [roomIds, setRoomIds] = useState([]);

  const socketRef = useRef(null);
  const lastTokenRef = useRef(readJwt());
  const refreshRoomsPromiseRef = useRef(null);

  const connect = useCallback(() => {
    const existing = socketRef.current;

    if (existing) {
      if (!existing.connected && !existing.active) {
        const token = readJwt();
        existing.auth = token ? { token } : {};
        existing.connect();
      }
      return existing;
    }

    const s = createSocket();
    socketRef.current = s;
    setSocket(s);
    return s;
  }, []);

  const disconnect = useCallback(() => {
    const current = socketRef.current;
    if (!current) return;

    try {
      current.disconnect();
    } catch {}

    socketRef.current = null;
    refreshRoomsPromiseRef.current = null;
    setSocket(null);
    setRoomIds([]);
  }, []);

  const reconnect = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log('[socket] reconnect triggered');
    }

    const current = socketRef.current;
    const token = readJwt();

    if (current) {
      current.auth = token ? { token } : {};
      current.connect();
      return current;
    }

    return connect();
  }, [connect]);

  const refreshRooms = useCallback(async () => {
    if (refreshRoomsPromiseRef.current) {
      return refreshRoomsPromiseRef.current;
    }

    refreshRoomsPromiseRef.current = (async () => {
      const candidates = [
        '/chatrooms',
      ];

      for (const path of candidates) {
        try {
          const { data } = await axiosClient.get(path);
          const rows = normalizeRoomArray(data);

          if (!rows) {
            if (import.meta.env.DEV) {
              console.warn('[socket] unexpected rooms payload for', path, data);
            }
            continue;
          }

          const ids = toRoomIds(rows);
          setRoomIds(ids);
          return ids;
        } catch (e) {
          const status = e?.response?.status;

          if (status === 401) {
            setRoomIds([]);
            return [];
          }

          if (status !== 404 && status !== 400) {
            console.warn('[socket] failed to load my rooms:', e?.message || e);
          }
        }
      }

      setRoomIds([]);
      return [];
    })();

    try {
      return await refreshRoomsPromiseRef.current;
    } finally {
      refreshRoomsPromiseRef.current = null;
    }
  }, []);


  useEffect(() => {
    if (!socket || !autoJoin) return;

    let cancelled = false;

    const onConnected = async () => {
      if (cancelled) return;

      const ids = roomIds.length ? roomIds : await refreshRooms();
      if (cancelled) return;
      if (!Array.isArray(ids) || !ids.length) return;

      try {
        socket.emit('join:rooms', ids.map(String));
        if (import.meta.env.DEV) {
          console.log('[socket] joined rooms:', ids);
        }
      } catch (e) {
        console.warn('[socket] join:rooms error', e?.message || e);
      }
    };

    if (socket.connected) {
      onConnected();
    }

    socket.on('connect', onConnected);

    return () => {
      cancelled = true;
      socket.off('connect', onConnected);
    };
  }, [socket, roomIds, autoJoin, refreshRooms]);

  useEffect(() => {
    const handleStorage = (e) => {
      if (!e) return;

      const keys = [COOKIE_NAME, 'token'];
      if (!keys.includes(e.key)) return;

      const nextToken = readJwt();
      if (nextToken === lastTokenRef.current) return;

      lastTokenRef.current = nextToken;

      if (import.meta.env.DEV) {
        console.log('[socket] token changed (storage); reconnecting');
      }

      reconnect();
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [reconnect]);

  const on = useCallback((event, handler) => socket?.on?.(event, handler), [socket]);
  const off = useCallback((event, handler) => socket?.off?.(event, handler), [socket]);
  const once = useCallback((event, handler) => socket?.once?.(event, handler), [socket]);
  const emit = useCallback((event, payload) => socket?.emit?.(event, payload), [socket]);

  const joinRooms = useCallback((ids) => {
    const current = socketRef.current;
    if (!current) return;
    current.emit('join:rooms', (ids || []).map(String));
  }, []);

  const leaveRoom = useCallback((id) => {
    const current = socketRef.current;
    if (!current || id == null) return;
    current.emit('leave_room', String(id));
  }, []);

  const value = useMemo(
    () => ({
      socket,
      connect,
      disconnect,
      reconnect,
      refreshRooms,
      setRoomIds,
      joinRooms,
      leaveRoom,
      on,
      off,
      once,
      emit,
    }),
    [
      socket,
      connect,
      disconnect,
      reconnect,
      refreshRooms,
      joinRooms,
      leaveRoom,
      on,
      off,
      once,
      emit,
    ]
  );

  return <SocketCtx.Provider value={value}>{children}</SocketCtx.Provider>;
}

export function useSocket() {
  return useContext(SocketCtx);
}

export function useSocketRaw() {
  return useContext(SocketCtx)?.socket ?? null;
}