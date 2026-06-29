import cookie from 'cookie';
import jwt from 'jsonwebtoken';

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'foria_jwt';
const JWT_SECRET = process.env.JWT_SECRET;

function extractToken(handshake) {
  // Try cookie first
  const raw = handshake.headers?.cookie || '';
  const cookies = cookie.parse(raw || '');
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];

  // Fallbacks for non-browser clients (tests, bots, mobile clients, etc.)
  if (handshake.auth?.token) return handshake.auth.token;
  if (handshake.query?.token) return handshake.query.token;

  return null;
}

export function cookieSocketAuth(io) {
  io.use((socket, next) => {
    try {

      const token = extractToken(socket.handshake);
      if (!token) return next(new Error('Unauthorized'));

      if (!JWT_SECRET) {
        return next(new Error('Server misconfiguration: JWT secret missing'));
      }

      const payload = jwt.verify(token, JWT_SECRET); // { id, username, role, plan, ... }

      // Attach user info to the socket
      socket.user = payload;
      socket.data.user = payload;

      // Join personal room
      if (payload?.id) socket.join(`user:${payload.id}`);

      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });
}
