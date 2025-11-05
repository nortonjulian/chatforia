let _io = null;
let _emitToUserImpl = null;

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
          _io.to(`user:${uid}`).emit(evt, payload);
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
  if (!_emitToUserImpl) return;
  _emitToUserImpl(userId, event, payload);
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

/** Test helper / hot-reload cleanup (not used in prod code paths). */
export function _resetSocketBus() {
  _io = null;
  _emitToUserImpl = null;
}
