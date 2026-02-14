// server/services/socketBus.js
// Central Socket.IO bus: lets HTTP routes/services emit socket events safely
// without importing the Socket.IO server everywhere.

let _io = null;
let _emitToUserImpl = null;

/**
 * Single source of truth for socket event names.
 * Keep these aligned with iOS/web clients.
 */
export const SOCKET_EVENTS = Object.freeze({
  // Messages
  MESSAGE_NEW: 'message:new',

  // Typing
  TYPING_UPDATE: 'typing:update',
});

/**
 * Registers the active Socket.IO instance and an optional custom emitToUser implementation.
 * Idempotent: last call wins (useful for hot-reload).
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
/* Typed / convenience emitters (recommended)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Broadcast a new message to everyone in a chat room.
 *
 * Payload shape intentionally matches iOS client decoding:
 * - either direct message object OR { item: message }
 *
 * We include roomId for debugging/clients that want it.
 */
export function emitMessageNew(chatRoomId, message) {
  if (chatRoomId == null || !message) return;

  emitToChatRoom(chatRoomId, SOCKET_EVENTS.MESSAGE_NEW, {
    roomId: Number(chatRoomId),
    item: message,
  });
}

/**
 * Broadcast typing updates to a room.
 * (Your socket layer already emits typing:update from typing:start/stop,
 * but this helper is here in case HTTP routes/services ever need it.)
 */
export function emitTypingUpdate(chatRoomId, payload) {
  if (chatRoomId == null) return;
  emitToChatRoom(chatRoomId, SOCKET_EVENTS.TYPING_UPDATE, payload);
}

/** Test helper / hot-reload cleanup (not used in prod code paths). */
export function _resetSocketBus() {
  _io = null;
  _emitToUserImpl = null;
}