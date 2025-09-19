import { randomUUID } from 'node:crypto';
export function requestId() {
  return (req, _res, next) => {
    req.id = req.id || randomUUID();
    next();
  };
}
