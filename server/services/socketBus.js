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
 *  - emitMessageAck(userId, payload)
 *  - emitMessageUpsertToUser(userId, chatRoomId, messageOrRow)
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
  fetchMessageById: null, // optional: async (id) => full authoritative message row
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
          } catch {
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
  } catch {
    /* noop */
  }
}

/** Emit to many users at once. */
export function emitToUsers(userIds, event, payload) {
  if (!_io) return;

  const rooms = (userIds || [])
    .filter((v) => v != null)
    .map((id) => `user:${String(id)}`);

  if (!rooms.length) return;

  try {
    try {
      _io.to(rooms).emit(event, payload);
    } catch {
      for (const room of rooms) {
        _io.to(room).emit(event, payload);
      }
    }
  } catch {
    /* noop */
  }
}

/** Sender-only ack for optimistic client reconciliation. */
export function emitMessageAck(userId, payload) {
  if (!_io || userId == null || !payload) return;

  try {
    _io.to(`user:${String(userId)}`).emit('message:ack', payload);
  } catch {
    /* noop */
  }
}

/** Emit to an arbitrary room id (string/number). */
export function emitToRoom(room, event, payload) {
  if (!_io || room == null || room === '') return;

  try {
    _io.to(String(room)).emit(event, payload);
  } catch {
    /* noop */
  }
}

/** Convenience: chat room namespace usually equals the chatRoomId. */
export function emitToChatRoom(chatRoomId, event, payload) {
  if (!_io || chatRoomId == null) return;

  try {
    _io.to(String(chatRoomId)).emit(event, payload);
  } catch {
    /* noop */
  }
}

/* -------------------------------------------------------------------------- */
/* Socket event names (single source of truth)                                */
/* -------------------------------------------------------------------------- */

export const SOCKET_EVENTS = Object.freeze({
  // Canonical
  MESSAGE_UPSERT: 'message:upsert',
  MESSAGE_EDITED: 'message:edited',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_EXPIRED: 'message:expired',
  TYPING_UPDATE: 'typing:update',

  // Legacy / transitional
  LEGACY_MESSAGE_NEW: 'message:new',
  LEGACY_MESSAGE_UPDATED: 'message:updated',
  LEGACY_MESSAGE_EXPIRED: 'message:expired',
});

/* -------------------------------------------------------------------------- */
/* Helper registration                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Register pluggable helpers used by emit helpers.
 *
 * Example:
 *   setHelpers({
 *     fetchMessageById: async (id) => {
 *       // return the full authoritative message object
 *     }
 *   });
 */
export function setHelpers({ fetchMessageById } = {}) {
  if (typeof fetchMessageById === 'function') {
    _helpers.fetchMessageById = fetchMessageById;
  }
}

/* -------------------------------------------------------------------------- */
/* Internal message resolution                                                 */
/* -------------------------------------------------------------------------- */

async function resolveMessagePayload(messageOrRow) {
  if (messageOrRow == null) return null;

  // If caller already passed a full message object / shaped row, use it directly.
  if (typeof messageOrRow === 'object' && messageOrRow.id != null) {
    return messageOrRow;
  }

  // If caller passed an id, resolve it through the registered fetch helper.
  const isNumericId =
    typeof messageOrRow === 'number' ||
    (typeof messageOrRow === 'string' && /^\d+$/.test(messageOrRow));

  if (isNumericId) {
    if (typeof _helpers.fetchMessageById !== 'function') {
      console.warn(
        '[socketBus] emitMessageUpsert called with message id but fetchMessageById helper is not registered:',
        messageOrRow
      );
      return null;
    }

    try {
      const row = await _helpers.fetchMessageById(Number(messageOrRow));
      if (!row) {
        console.warn('[socketBus] fetchMessageById returned no row for id:', messageOrRow);
        return null;
      }
      return row;
    } catch (err) {
      console.warn(
        '[socketBus] fetchMessageById failed for id:',
        messageOrRow,
        err?.message || err
      );
      return null;
    }
  }

  console.warn('[socketBus] Unsupported message payload shape:', messageOrRow);
  console.log(`[socketBus] Emitted message:upsert to room ${roomIdStr} for message ${payloadRow.id || 'unknown'}`);
  return null;
}

/* -------------------------------------------------------------------------- */
/* Canonical emit helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Emit the full authoritative message row to a chat room.
 *
 * messageOrRow may be:
 *  - a full shaped message object (preferred), or
 *  - a message id, if fetchMessageById has been registered via setHelpers(...)
 */
export async function emitMessageUpsert(chatRoomId, messageOrRow) {
  if (chatRoomId == null || messageOrRow == null) return;
  if (!_io) {
    console.warn('[socketBus] emitMessageUpsert called before io was set');
    return;
  }

  const payloadRow = await resolveMessagePayload(messageOrRow);
  if (!payloadRow) return;

  const roomIdStr = String(chatRoomId);

  try {
    // Emit clean, consistent payload that both iOS and web expect
    _io.to(roomIdStr).emit('message:upsert', { 
      item: payloadRow 
    });

    console.log(`[socketBus] Emitted message:upsert to room ${roomIdStr} for message ${payloadRow.id || 'unknown'}`);
  } catch (err) {
    console.warn('[socketBus] emitMessageUpsert failed', err?.message || err);
  }
}

/**
 * Deprecated wrapper for older codepaths.
 * Uses canonical upsert underneath.
 */
export async function emitMessageNew(chatRoomId, messageOrRow) {
  await emitMessageUpsert(chatRoomId, messageOrRow);
}

/**
 * Deprecated wrapper for older codepaths.
 * Uses canonical upsert underneath.
 */
export async function emitMessageUpdated(chatRoomId, messageOrRow) {
  await emitMessageUpsert(chatRoomId, messageOrRow);
}

/**
 * Emit an authoritative expired/tombstoned message state.
 * Uses canonical upsert underneath.
 */
export async function emitMessageExpired(chatRoomId, messageOrId, _expiresAt) {
  await emitMessageUpsert(chatRoomId, messageOrId);
}

/**
 * Optional helper for sender-specific/private realtime upserts.
 * Useful if one day you want per-user shaped payloads.
 */
export async function emitMessageUpsertToUser(userId, chatRoomId, messageOrRow) {
  if (!_io || userId == null || chatRoomId == null || messageOrRow == null) return;

  const payloadRow = await resolveMessagePayload(messageOrRow);
  if (!payloadRow) return;

  try {
    emitToUser(userId, SOCKET_EVENTS.MESSAGE_UPSERT, {
      roomId: Number(chatRoomId),
      item: payloadRow,
    });
  } catch {
    /* noop */
  }
}

/* -------------------------------------------------------------------------- */
/* Test helper / hot-reload cleanup                                            */
/* -------------------------------------------------------------------------- */

export function _resetSocketBus() {
  _io = null;
  _emitToUserImpl = null;
  _helpers = { fetchMessageById: null };
}