/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { createRequestLoggingMiddleware } from '../middleware/requestLogging.js';

describe('real HTTP request logging', () => {
  test('never includes capability tokens in successful, denied or missing-route request logs', async () => {
    const logLines = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(String(chunk));
        callback();
      },
    });
    const testLogger = pino({ level: 'info', base: null }, destination);
    const app = express();
    app.use(createRequestLoggingMiddleware({ logger: testLogger }));
    app.get('/files', (_req, res) => res.sendStatus(200));
    app.get('/private-media/file', (_req, res) => res.sendStatus(403));

    const cases = [
      {
        url: '/private-media/file?token=SIGNED_PRIVATE_DO_NOT_LOG',
        status: 403,
        path: '/private-media/file',
      },
      {
        url: '/files?token=LEGACY_PRIVATE_DO_NOT_LOG',
        status: 200,
        path: '/files',
      },
      {
        url: '/missing?token=OTHER_PRIVATE_DO_NOT_LOG',
        status: 404,
        path: '/missing',
      },
    ];

    for (const { url, status } of cases) {
      const response = await request(app).get(url);
      expect(response.status).toBe(status);
    }

    const entries = logLines.join('').trim().split('\n').filter(Boolean).map(JSON.parse);
    expect(entries).toHaveLength(cases.length);

    for (const [index, { path, status }] of cases.entries()) {
      const entry = entries[index];
      expect(entry.req.url).toBe(path);
      expect(entry.path).toBe(path);
      expect(entry.method).toBe('GET');
      expect(entry.res.statusCode).toBe(status);
      expect(JSON.stringify(entry)).not.toMatch(/(?:SIGNED|LEGACY|OTHER)_PRIVATE_DO_NOT_LOG/);
      expect(JSON.stringify(entry)).not.toContain('?token=');
    }
  });
});
