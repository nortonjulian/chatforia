import express from 'express';
import authRouter from './auth.js';

const router = express.Router();
router.post('/start', (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = { phone: req.body.phone ?? req.body.phoneNumber, consent: req.body.consent };
  }
  const originalUrl = req.url;
  req.url = '/send-verify';
  return authRouter(req, res, error => { req.url = originalUrl; next(error); });
});
export default router;
