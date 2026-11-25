// Browser cookie precedence matches authenticated API requests. Mobile
// clients authenticate with Bearer when there is no session cookie.
export function sessionTokenFromRequest(req, cookieName = 'foria_jwt') {
  const cookieToken = req.cookies?.[cookieName];
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] || null;
}
