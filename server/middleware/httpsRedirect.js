export function httpsRedirect() {
  const enabled =
    process.env.NODE_ENV === 'production' &&
    String(process.env.FORCE_HTTPS || 'true') !== 'false';

  return (req, res, next) => {
    if (!enabled) return next();

    // Never redirect CORS preflight requests
    if (req.method === 'OPTIONS') return next();

    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');

    if (proto !== 'https') {
      const host = req.get('host');
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }

    next();
  };
}