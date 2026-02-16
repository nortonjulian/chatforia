/**
 * server/services/socketBus.js
 *
 * Central Socket.IO bus: lets HTTP routes/services emit socket events safely
 * without importing the Socket.IO server everywhere.
 *
 * Exported API (named exports):
 *  - setSocketIo(io, emitToUser)
 *  - getIo()
 *  - isReady()
 *  - emitToUser(userId, event, payload)
 *  - emitToUsers(userIds, event, payload)
 *  - emitToRoom(room, event, payload)
 *  - emitToChatRoom(chatRoomId, event, payload)
 *  - setHelpers({ fetchMessageById })
 *  - emitMessageUpsert(chatRoomId, messageOrRow)
 *  - emitMessageNew(...)
 *  - emitMessageUpdated(...)
 *  - emitMessageExpired(...)
 *  - SOCKET_EVENTS
 *  - _resetSocketBus()   // test / hot-reload helper
 */

/* -------------------------------------------------------------------------- */
/* Internal runtime handles                                                    */
/* -------------------------------------------------------------------------- */

let _io = null;
let _emitToUserImpl = null;

/* -------------------------------------------------------------------------- */
/* Helpers / pluggable operations                                              */
/* -------------------------------------------------------------------------- */

let _helpers = {
  fetchMessageById: null, // optional: (id) => Promise<messageRow>
};

/**
 * Register the active Socket.IO instance and an optional custom emitToUser implementation.
 * Idempotent: last call wins (useful for hot-reload).
 *
 * Typical usage (server/index.js):
 *   const { io, emitToUser } = initSocket(server);
 *   setSocketIo(io, emitToUser);
 */
export function setSocketIo(io, emitToUser) {
  _io = io || null;

  _emitToUserImpl =
    typeof emitToUser === 'function'
      ? emitToUser
      : (uid, evt, payload) => {
          if (!_io || uid == null) return;
          try {
            _io.to(`user:${String(uid)}`).emit(evt, payload);
          } catch (err) {
            // swallow - we don't want socket issues to crash services
            /* noop */
          }
        };
}

/** Returns the raw io instance (or null if not set). */
export function getIo() {
  return _io;
}

/** Quick readiness check for routes/services that want to bail if sockets aren’t up yet. */
export function isReady() {
  return !!_io;
}

/** Emit to a single user's private room: user:{id} */
export function emitToUser(userId, event, payload) {
  if (_emitToUserImpl) return _emitToUserImpl(userId, event, payload);
  if (!_io || userId == null) return;
  try {
    _io.to(`user:${String(userId)}`).emit(event, payload);
  } catch (err) {
    /* noop */
  }
}

/** Emit to many users at once (fanout is efficient: io.to([...rooms])). */
export function emitToUsers(userIds, event, payload) {
  if (!_io) return;
  const rooms = (userIds || [])
    .filter((v) => v != null)
    .map((id) => `user:${String(id)}`);
  if (!rooms.length) return;

  try {
    // socket.io supports passing an array of rooms to to(), but some adapters/versions may not.
    // Try the array form first, otherwise fallback to emitting per-room.
    try {
      _io.to(rooms).emit(event, payload);
    } catch (e) {
      for (const r of rooms) {
        _io.to(r).emit(event, payload);
      }
    }
  } catch (err) {
    /* noop */
  }
}

/** Emit to an arbitrary room id (string/number). */
export function emitToRoom(room, event, payload) {
  if (!_io || !room) return;
  try {
    _io.to(String(room)).emit(event, payload);
  } catch (err) {
    /* noop */
  }
}

/** Convenience: chat room namespace usually equals the chatRoomId. */
export function emitToChatRoom(chatRoomId, event, payload) {
  if (!_io || chatRoomId == null) return;
  try {
    _io.to(String(chatRoomId)).emit(event, payload);
  } catch (err) {
    /* noop */
  }
}

/* -------------------------------------------------------------------------- */
/* Socket event names (single source of truth)                                */
/* -------------------------------------------------------------------------- */

/**
 * Single source of truth for socket event names.
 * Keep these aligned with iOS/web clients.
 */
export const SOCKET_EVENTS = Object.freeze({
  MESSAGE_UPSERT: 'message:upsert',
  TYPING_UPDATE: 'typing:update',
  // backwards-compatible / legacy names for reference:
  LEGACY_MESSAGE_NEW: 'message:new',
  LEGACY_MESSAGE_UPDATED: 'message:updated',
  LEGACY_MESSAGE_EXPIRED: 'message:expired',
});

/* -------------------------------------------------------------------------- */
/* Helpers that routes/services can use (canonical upsert + migration paths)  */
/* -------------------------------------------------------------------------- */

/**
 * Register pluggable helpers used by emit helpers (keeps socketBus decoupled from DB).
 *
 * Example:
 *   setHelpers({ fetchMessageById: async (id) => prisma.message.findUnique(...) })
 */
export function setHelpers({ fetchMessageById } = {}) {
  if (typeof fetchMessageById === 'function') _helpers.fetchMessageById = fetchMessageById;
}

/**
 * Emit the full authoritative message row to a chat room.
 *
 * messageOrRow may be:
 *  - a DB row / message object (preferred), or
 *  - an id (number or numeric string) if the caller cannot easily fetch the row.
 *
 * If the caller passes only an id, this helper will attempt to fetch the
 * full row using a registered fetchMessageById implementation.
 */
export async function emitMessageUpsert(chatRoomId, messageOrRow) {
  if (chatRoomId == null || messageOrRow == null) return;

  let payloadRow = null;

  // If caller passed a plain id (number or numeric string)
  if (typeof messageOrRow === 'number' || (typeof messageOrRow === 'string' && /^\d+$/.test(messageOrRow))) {
    if (typeof _helpers.fetchMessageById !== 'function') return; // can't fetch, so bail
    try {
      payloadRow = await _helpers.fetchMessageById(Number(messageOrRow));
      if (!payloadRow) return;
    } catch (err) {
      // fetch failed — bail silently
      return;
    }
  } else if (typeof messageOrRow === 'object' && messageOrRow.id != null) {
    // Already a message object / DB row — use it directly
    payloadRow = messageOrRow;
  } else {
    // Unsupported shape — ignore
    return;
  }

  // Emit canonical upsert event
  try {
    emitToChatRoom(chatRoomId, SOCKET_EVENTS.MESSAGE_UPSERT, {
      roomId: Number(chatRoomId),
      item: payloadRow,
      meta: { source: 'server' },
    });
  } catch (err) {
    /* noop */
  }
}

/* -------------------------------------------------------------------------- */
/* Backwards-compatible wrappers (optional; helpful during migration)         */
/* -------------------------------------------------------------------------- */

/**
 * Deprecated wrapper for older codepaths.
 * Calls emitMessageUpsert(...) under the hood.
 *
 * Keep this while you update callers and remove legacy events later.
 */
export async function emitMessageNew(chatRoomId, messageOrRow) {
  // Prefer emitting canonical upsert only
  await emitMessageUpsert(chatRoomId, messageOrRow);

  // OPTIONAL: temporarily emit the legacy event too so old clients don't break.
  // Uncomment to keep backward compatibility for older clients while migrating.
  // try {
  //   emitToChatRoom(chatRoomId, SOCKET_EVENTS.LEGACY_MESSAGE_NEW, {
  //     roomId: Number(chatRoomId),
  //     item: messageOrRow && messageOrRow.id ? messageOrRow : { id: Number(messageOrRow) },
  //   });
  // } catch (e) { /* noop */ }
}

export async function emitMessageUpdated(chatRoomId, messageOrRow) {
  await emitMessageUpsert(chatRoomId, messageOrRow);
  // Optional legacy emit:
  // try {
  //   emitToChatRoom(chatRoomId, SOCKET_EVENTS.LEGACY_MESSAGE_UPDATED, {
  //     roomId: Number(chatRoomId),
  //     item: messageOrRow && messageOrRow.id ? messageOrRow : { id: Number(messageOrRow) },
  //   });
  // } catch (e) { /* noop */ }
}

/**
 * Emit a message expired notification.
 *
 * This helper tries to emit an upsert first so clients receive the authoritative
 * row (with updated expiresAt / isExpired fields), then emits an optional
 * legacy 'message:expired' removal event for older clients.
 *
 * @param {number|string} chatRoomId
 * @param {object|number|string} messageOrId - message row or id
 * @param {string|Date|number} [expiresAt] - optional expiresAt value for legacy payload
 */
export async function emitMessageExpired(chatRoomId, messageOrId, expiresAt) {
  // Try to emit an upsert for the authoritative row (with updated expiresAt).
  await emitMessageUpsert(chatRoomId, messageOrId);

  // Optional legacy emit (remove after migration)
  // try {
  //   const id = typeof messageOrId === 'object' && messageOrId.id ? messageOrId.id : Number(messageOrId);
  //   emitToChatRoom(chatRoomId, SOCKET_EVENTS.LEGACY_MESSAGE_EXPIRED, {
  //     roomId: Number(chatRoomId),
  //     id: Number(id),
  //     expiresAt: expiresAt ?? null,
  //   });
  // } catch (e) { /* noop */ }
}

/** Test helper / hot-reload cleanup (not used in prod code paths). */
export function _resetSocketBus() {
  _io = null;
  _emitToUserImpl = null;
  _helpers = { fetchMessageById: null };
}