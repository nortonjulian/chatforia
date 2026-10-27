/**
 * Never log capability tokens, OTP links or other bearer credentials embedded
 * in query strings. Operational logs should contain only the route pathname.
 */
export function logSafeRequestPath(value) {
  const text = typeof value === 'string' ? value : '';
  return text.split(/[?#]/, 1)[0] || '/';
}
