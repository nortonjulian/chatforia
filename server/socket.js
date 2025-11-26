import { Server } from 'socket.io';
import cookie from 'cookie';
import jwt from 'jsonwebtoken';
import prisma from './utils/prismaClient.js';
import { setSocketIo } from './services/socketBus.js';
// If your random chat module does not export this, either add a no-op export there or comment this out:
import { attachRandomChatSockets } from './routes/randomChats.js';

/** CORS origins */
function parseOrigins() {
  const fallback = ['http://localhost:5173', 'http://localhost:5002'];
  const raw = process.env.CORS_ORIGINS || process.env.FRONTEND_ORIGIN || process.env.WEB_ORIGIN || '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

/** Extract JWT from handshake */
function getTokenFromHandshake(handshake) {
  if (handshake.auth?.token) return handshake.auth.token;   // preferred: socket.auth.token
  if (handshake.query?.token) return handshake.query.token; // optional fallback

  if (handshake.headers?.cookie) {
    const cookies = cookie.parse(handshake.headers.cookie || '');
    const name = process.env.JWT_COOKIE_NAME || 'foria_jwt';
    if (cookies[name]) return cookies[name];
  }
  return null;
}

/** Fetch all chatRoomIds a user belongs to */
async function getUserRoomIds(userId) {
  const rows = await prisma.participant.findMany({
    where: { userId: Number(userId) },
    select: { chatRoomId: true },
  });
  return [...new Set(rows.map((r) => String(r.chatRoomId)))];
}

/**
 * Initialize Socket.IO on the given HTTP server.
 * If REDIS_URL is set, a cross-node pub/sub adapter is enabled.
 */
export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: parseOrigins(), credentials: true },
    path: '/socket.io',
  });

  // engine.io low-level handshake errors (CORS, headers)
  io.engine.on('connection_error', (err) => {
    console.error('[WS] engine connection_error', {
      code: err.code,
      message: err.message,
      headersOrigin: err.context?.request?.headers?.origin,
      url: err.context?.request?.url,
    });
  });

  // Optional Redis adapter for multi-instance scale-out
  let pub = null;
  let sub = null;

  async function maybeAttachRedisAdapter() {
    if (!process.env.REDIS_URL) return;
    try {
      const [{ createAdapter }, { createClient }] = await Promise.all([
        import('@socket.io/redis-adapter'),
        import('redis'),
      ]);
      pub = createClient({ url: process.env.REDIS_URL });
      sub = createClient({ url: process.env.REDIS_URL });
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      console.log('[WS] Redis adapter enabled');
    } catch (err) {
      console.error('[WS] Failed to enable Redis adapter:', err?.message || err);
    }
  }

  // ---- Auth middleware ----
  // ---- Auth middleware ----
io.use(async (socket, next) => {
  try {
    const token = getTokenFromHandshake(socket.handshake);
    if (!token) {
      console.warn('[WS] no token in handshake', {
        origin: socket.handshake?.headers?.origin,
        hasCookie: Boolean(socket.handshake?.headers?.cookie),
        queryKeys: Object.keys(socket.handshake?.query || {}),
        authKeys: Object.keys(socket.handshake?.auth || {}),
      });
      return next(new Error('Unauthorized: no token'));
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) return next(new Error('Server misconfiguration: JWT secret missing'));

    const decoded = jwt.verify(token, secret); // { id, username, plan, role, ... }

    // 🔍 Hydrate full user from DB so we get preferredLanguage + foriaRemember
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        plan: true,
        preferredLanguage: true,
        foriaRemember: true,
      },
    });

    if (!user) {
      console.warn('[WS] no user found for decoded token id:', decoded.id);
      return next(new Error('Unauthorized'));
    }

    // Attach hydrated user to socket
    socket.user = user;
    socket.data.user = user;

    if (user.id) socket.join(`user:${user.id}`); // personal unicast room

    if (process.env.NODE_ENV !== 'test') {
      console.log('[WS] authed socket user:', {
        id: user.id,
        username: user.username,
        preferredLanguage: user.preferredLanguage,
        foriaRemember: user.foriaRemember,
      });
    }

    next();
  } catch (err) {
    console.error('Socket auth failed:', err?.message || err);
    next(new Error('Unauthorized'));
  }
});

  // ---- Feature sockets that need an authenticated socket (if available) ----
  if (typeof attachRandomChatSockets === 'function') {
    attachRandomChatSockets(io);
  }

  // ---- Connection handler ----
  io.on('connection', async (socket) => {
    const userId = socket.user?.id;
    if (process.env.NODE_ENV !== 'test') {
      console.log('[WS] connected user:', socket.user?.username || userId);
    }

    // Optional auto-join existing rooms (opt-in)
    if (process.env.SOCKET_AUTOJOIN === 'true' && userId) {
      try {
        const rooms = await getUserRoomIds(userId);
        if (rooms.length) {
          await Promise.all(rooms.map((rid) => socket.join(String(rid))));
          console.log(`[WS] auto-joined ${rooms.length} rooms for user:${userId}`);
        }
      } catch (e) {
        console.warn('[WS] auto-join failed:', e?.message || e);
      }
    }

    // Bulk join (client can send a batch)
    socket.on('join:rooms', async (roomIds) => {
      try {
        if (!Array.isArray(roomIds)) return;
        const ids = roomIds.map((r) => String(r)).filter(Boolean);
        for (const rid of ids) await socket.join(rid);
        console.log(`[WS] user:${userId} joined rooms:`, ids);
      } catch (e) {
        console.warn('[WS] join:rooms error', e?.message || e);
      }
    });

    // Back-compat: single join/leave
    socket.on('join_room', async (roomId) => {
      if (!roomId) return;
      await socket.join(String(roomId));
      console.log(`[WS] user:${userId} joined room ${roomId}`);
    });
    socket.on('leave_room', async (roomId) => {
      if (!roomId) return;
      await socket.leave(String(roomId));
      console.log(`[WS] user:${userId} left room ${roomId}`);
    });

    // Optional UX signal in dev
    socket.on('message_copied', ({ messageId }) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[WS] user:${userId} copied message ${messageId}`);
      }
    });

    // WebRTC: relay ICE candidates to a user-specific room
    socket.on('call:candidate', ({ callId, to, candidate }) => {
      if (!callId || !to || !candidate) return;
      io.to(`user:${to}`).emit('call:candidate', { callId, candidate });
    });

    socket.on('disconnect', (reason) => {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[WS] user:${userId} disconnected:`, reason);
      }
    });
  });

  function emitToUser(userId, event, payload) {
    io.to(`user:${userId}`).emit(event, payload);
  }

  // Expose to HTTP layer
  setSocketIo(io, emitToUser);

  // Defer Redis adapter init until after IO up
  void maybeAttachRedisAdapter();

  // Provide a cleanup hook for graceful shutdowns
  async function close() {
    try {
      if (pub) await pub.quit();
      if (sub) await sub.quit();
    } catch (e) {
      console.warn('[WS] redis quit error:', e?.message || e);
    }
    await new Promise((res) => io.close(res));
  }

  return { io, emitToUser, close };
}
