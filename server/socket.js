import { Server } from 'socket.io';
import cookie from 'cookie';
import jwt from 'jsonwebtoken';
import prisma from './utils/prismaClient.js';
import { setSocketIo } from './services/socketBus.js';

/** Env helpers */
const IS_TEST = String(process.env.NODE_ENV || '') === 'test';
const IS_PROD = String(process.env.NODE_ENV || '') === 'production';

/**
 * Parse allowed CORS origins for Socket.IO.
 *
 * Recommended:
 * - set CORS_ORIGINS="https://chatforia.com,https://www.chatforia.com,http://localhost:5173"
 *
 * Behavior:
 * - If env is provided, we use it exactly.
 * - If env is missing:
 *   - dev/test fallback: localhost
 *   - prod fallback: chatforia.com domains (so you don't brick prod if env missing)
 */
function parseOrigins() {
  const raw =
    process.env.CORS_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    process.env.WEB_ORIGIN ||
    '';

  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.length) return list;

  // Sensible defaults if env isn't set
  if (IS_PROD) {
    return ['https://chatforia.com', 'https://www.chatforia.com'];
  }

  return ['http://localhost:5173', 'http://localhost:5002'];
}

/** Extract JWT from handshake */
function getTokenFromHandshake(handshake) {
  // 1) Preferred: explicit auth token
  if (handshake.auth?.token) return handshake.auth.token;

  // 2) Optional fallback: query token
  if (handshake.query?.token) return handshake.query.token;

  // 3) Cookie token (preferred if you’re using cookie auth on web)
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
    cors: {
      origin: parseOrigins(),
      credentials: true,
    },
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

      // ✅ Match server/middleware/auth.js fallback behavior
      const secret =
        process.env.JWT_SECRET || (IS_TEST ? 'test_secret' : 'dev_secret');

      let decoded;
      try {
        decoded = jwt.verify(token, secret); // { id, username, plan, role, ... }
      } catch (e) {
        console.warn('[WS] jwt verify failed', e?.message || e);
        return next(new Error('Unauthorized'));
      }

      // Hydrate from DB (preferredLanguage, etc.)
      const user = await prisma.user.findUnique({
        where: { id: Number(decoded.id) },
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

      socket.user = user;
      socket.data.user = user;

      // personal unicast room (for per-user events like delete-for-me)
      socket.join(`user:${user.id}`);

      if (!IS_TEST) {
        console.log('[WS] authed socket user:', {
          id: user.id,
          username: user.username,
          preferredLanguage: user.preferredLanguage,
          foriaRemember: user.foriaRemember,
        });
      }

      return next();
    } catch (err) {
      console.error('[WS] auth failed:', err?.message || err);
      return next(new Error('Unauthorized'));
    }
  });

  // ---- Attach feature sockets (safe import) ----
  (async () => {
    try {
      const mod = await import('./routes/randomChats.js');
      if (typeof mod.attachRandomChatSockets === 'function') {
        mod.attachRandomChatSockets(io);
      }
    } catch (e) {
      // random chats are optional — never crash socket layer
      if (!IS_TEST) {
        console.warn('[WS] random chat sockets not attached:', e?.message || e);
      }
    }
  })().catch(() => {});

  // ---- Connection handler ----
  io.on('connection', async (socket) => {
    const userId = socket.user?.id;

    // ✅ track last room where this user was typing (per socket)
    let lastTypingRoomId = null;

    if (!IS_TEST) {
      console.log('[WS] connected user:', socket.user?.username || userId);
    }

    // Optional auto-join all rooms this user is in
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

    // Bulk join (preferred)
    socket.on('join:rooms', async (roomIds) => {
      try {
        if (!Array.isArray(roomIds)) return;
        const ids = roomIds.map((r) => String(r)).filter(Boolean);
        for (const rid of ids) await socket.join(rid);
        if (!IS_TEST) console.log(`[WS] user:${userId} joined rooms:`, ids);
      } catch (e) {
        console.warn('[WS] join:rooms error', e?.message || e);
      }
    });

    // Back-compat: single join/leave
    socket.on('join_room', async (roomId) => {
      try {
        if (!roomId) return;
        await socket.join(String(roomId));
        if (!IS_TEST) console.log(`[WS] user:${userId} joined room ${roomId}`);
      } catch (e) {
        console.warn('[WS] join_room error', e?.message || e);
      }
    });

    socket.on('leave_room', async (roomId) => {
      try {
        if (!roomId) return;
        await socket.leave(String(roomId));
        if (!IS_TEST) console.log(`[WS] user:${userId} left room ${roomId}`);
      } catch (e) {
        console.warn('[WS] leave_room error', e?.message || e);
      }
    });

    // ---- Typing indicators ----
    socket.on('typing:start', ({ roomId }) => {
      try {
        if (!roomId) return;

        lastTypingRoomId = Number(roomId); // ✅ remember

        socket.to(String(roomId)).emit('typing:update', {
          roomId: Number(roomId),
          userId: socket.user?.id,
          username: socket.user?.username,
          isTyping: true,
        });
      } catch (e) {
        if (!IS_TEST) console.warn('[WS] typing:start error', e?.message || e);
      }
    });

    socket.on('typing:stop', ({ roomId }) => {
      try {
        if (!roomId) return;

        lastTypingRoomId = Number(roomId); // ✅ remember

        socket.to(String(roomId)).emit('typing:update', {
          roomId: Number(roomId),
          userId: socket.user?.id,
          username: socket.user?.username,
          isTyping: false,
        });
      } catch (e) {
        if (!IS_TEST) console.warn('[WS] typing:stop error', e?.message || e);
      }
    });

  socket.on('disconnect', (reason) => {
    // ✅ If the user disconnects mid-typing, force-stop typing for others
    if (lastTypingRoomId) {
      try {
        socket.to(String(lastTypingRoomId)).emit('typing:update', {
          roomId: lastTypingRoomId,
          userId: socket.user?.id,
          username: socket.user?.username,
          isTyping: false,
        });
      } catch (e) {
        if (!IS_TEST) console.warn('[WS] disconnect typing cleanup error', e?.message || e);
      }
    }

    if (!IS_TEST) {
      console.log(`[WS] user:${userId} disconnected:`, reason);
    }
  });
});

  function emitToUser(userId, event, payload) {
    io.to(`user:${userId}`).emit(event, payload);
  }

  // Expose to HTTP layer (other services can broadcast)
  setSocketIo(io, emitToUser);

  void maybeAttachRedisAdapter();

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
