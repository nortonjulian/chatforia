import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import aiRouter from './routes/ai.js';
import aiPowerRouter from './routes/ai.power.js';
import chatroomsRouter from './routes/chatrooms.js';
import messagesRouter from './routes/messages.js';

// --- Ensure test defaults if not already set ---
process.env.JWT_SECRET ??= 'test-secret';
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173';
process.env.FILE_TOKEN_SECRET ??= 'file-secret';

export default async function appFactory() {
  const app = express();

  const FRONTEND_ORIGIN =
    process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173';

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: FRONTEND_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Requested-With'],
    })
  );
  app.use(cookieParser());
  app.use(express.json());

  // same CSRF header check as prod
  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const ok = req.headers['x-requested-with'] === 'XMLHttpRequest';
      if (!ok) return res.status(403).json({ error: 'CSRF check failed' });
    }
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // mount what tests use
  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/ai', aiRouter);
  app.use('/ai/power', aiPowerRouter);
  app.use('/chatrooms', chatroomsRouter);
  app.use('/messages', messagesRouter);

  return app;
}
