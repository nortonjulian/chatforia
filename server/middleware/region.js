export function inferRegion(req, _res, next) {
  const h = req.headers['accept-language'] || '';
  const part = String(h).split(',')[0]; // e.g., "en-US"
  const iso2 = (part.split('-')[1] || '').toUpperCase();
  req.region = /^[A-Z]{2}$/.test(iso2) ? iso2 : 'US';
  next();
}
