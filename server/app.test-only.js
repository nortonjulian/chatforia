import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import listEndpoints from 'express-list-endpoints';

import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createTestApp() {
  const app = express();

  app.use(cookieParser());
  app.use(express.json());
  app.use(helmet({ crossOriginEmbedderPolicy: false }));
  app.use(compression());
  app.use(cors({ origin: true, credentials: true }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  if (process.env.NODE_ENV !== 'production') {
    app.get('/__routes_dump', (_req, res) => {
      const routes = listEndpoints(app)
        .flatMap((r) =>
          (r.methods || []).map((m) => ({ method: m, path: r.path }))
        )
        .sort(
          (a, b) =>
            a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
        );

      res.json({
        routes,
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}