// Central Socket.IO bus: lets HTTP routes/services emit socket events safely
// without importing the Socket.IO server everywhere.

// Internal runtime handles
let _io = null;
let _emitToUserImpl = null;

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
          _io.to(`user:${String(uid)}`).emit(evt, payload);
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
  // ✅ robust fallback if setSocketIo was called without a custom emitToUser impl
  if (_emitToUserImpl) return _emitToUserImpl(userId, event, payload);
  if (!_io || userId == null) return;
  _io.to(`user:${String(userId)}`).emit(event, payload);
}

/** Emit to many users at once (fanout is efficient: io.to([...rooms])). */
export function emitToUsers(userIds, event, payload) {
  if (!_io) return;
  const rooms = (userIds || [])
    .filter((v) => v != null)
    .map((id) => `user:${String(id)}`);
  if (rooms.length) _io.to(rooms).emit(event, payload);
}

/** Emit to an arbitrary room id (string/number). */
export function emitToRoom(room, event, payload) {
  if (!_io || !room) return;
  _io.to(String(room)).emit(event, payload);
}

/** Convenience: chat room namespace usually equals the chatRoomId. */
export function emitToChatRoom(chatRoomId, event, payload) {
  if (!_io || chatRoomId == null) return;
  _io.to(String(chatRoomId)).emit(event, payload);
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
});

/* -------------------------------------------------------------------------- */
/* Helpers that routes/services can use (canonical upsert + migration paths)  */
/* -------------------------------------------------------------------------- */

/**
 * Emit the full authoritative message row to a chat room.
 *
 * messageOrRow may be:
 *  - a DB row / message object (preferred), or
 *  - an id (number or numeric string) if the caller cannot easily fetch the row.
 *
 * If the caller passes only an id, this helper will attempt to fetch the
 * full row using an optional fetchMessageById implementation that you can
 * register via setHelpers() below. That keeps socketBus decoupled from Prisma.
 */
let _helpers = {
  fetchMessageById: null, // optional: (id) => Promise<messageRow>
};

export function setHelpers({ fetchMessageById } = {}) {
  if (typeof fetchMessageById === 'function') _helpers.fetchMessageById = fetchMessageById;
}

export async function emitMessageUpsert(chatRoomId, messageOrRow) {
  if (chatRoomId == null || messageOrRow == null) return;

  let payloadRow = null;

  // If caller passed a plain id (number or numeric string)
  if (
    (typeof messageOrRow === 'number') ||
    (typeof messageOrRow === 'string' && /^\d+$/.test(messageOrRow))
  ) {
    if (!_helpers.fetchMessageById) return; // can't fetch, so bail
    payloadRow = await _helpers.fetchMessageById(Number(messageOrRow));
    if (!payloadRow) return;
  } else if (typeof messageOrRow === 'object' && messageOrRow.id != null) {
    // Already a message object / DB row — use it directly
    payloadRow = messageOrRow;
  } else {
    // Unsupported shape — ignore
    return;
  }

  emitToChatRoom(chatRoomId, SOCKET_EVENTS.MESSAGE_UPSERT, {
    roomId: Number(chatRoomId),
    item: payloadRow,
  });
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
  // emitToChatRoom(chatRoomId, 'message:new', { roomId: Number(chatRoomId), item: messageOrRow });
}

export async function emitMessageUpdated(chatRoomId, messageOrRow) {
  await emitMessageUpsert(chatRoomId, messageOrRow);
  // Optional legacy emit:
  // emitToChatRoom(chatRoomId, 'message:updated', { roomId: Number(chatRoomId), item: messageOrRow });
}

export async function emitMessageExpired(chatRoomId, messageOrId, expiresAt) {
  // Try to emit an upsert for the authoritative row (with updated expiresAt).
  await emitMessageUpsert(chatRoomId, messageOrId);

  // Optional legacy emit (remove after migration)
  // emitToChatRoom(chatRoomId, 'message:expired', {
  //   roomId: Number(chatRoomId),
  //   id: Number(typeof messageOrId === 'object' ? messageOrId.id : messageOrId),
  //   expiresAt,
  // });
}

/** Test helper / hot-reload cleanup (not used in prod code paths). */
export function _resetSocketBus() {
  _io = null;
  _emitToUserImpl = null;
}