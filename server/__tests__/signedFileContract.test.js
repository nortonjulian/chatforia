/** @jest-environment node */
import { describe, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { signDownloadToken } from '../utils/downloadTokens.js';
import jwt from 'jsonwebtoken';
import filesRouter from '../routes/files.js';

describe('authenticated signed file download contract', () => {
  test('real signed token: owner can read, another user cannot; expired token fails', async () => {
    const previousRoot = process.env.UPLOADS_DIR;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chatforia-signed-file-'));
    process.env.UPLOADS_DIR = root;

    try {
      await fs.mkdir(path.join(root, 'media'), { recursive: true });
      await fs.writeFile(path.join(root, 'media', 'test.txt'), 'private test content');

      const app = express();
      app.use('/files', filesRouter);
      const token = signDownloadToken({ path: 'media/test.txt', ownerId: 101, ttlSec: 60 });

      const authorized = await request(app).get('/files')
        .set('x-test-user-id', '101')
        .query({ token });
      expect(authorized.status).toBe(200);
      expect(authorized.text).toBe('private test content');

      const forbidden = await request(app).get('/files')
        .set('x-test-user-id', '202')
        .query({ token });
      expect(forbidden.status).toBe(403);
      expect(forbidden.text).not.toContain('private test content');

      // A correctly signed but already expired token must not reveal the file.
      const expiredToken = jwt.sign(
        { p: 'media/test.txt', o: 101, u: 'file', aud: 'download', iss: 'chatforia', exp: Math.floor(Date.now() / 1000) - 30 },
        process.env.FILE_TOKEN_SECRET || 'test-secret'
      );
      const expired = await request(app).get('/files')
        .set('x-test-user-id', '101')
        .query({ token: expiredToken });
      expect(expired.status).not.toBe(200);
      expect(expired.text).not.toContain('private test content');

      const missingToken = await request(app).get('/files')
        .set('x-test-user-id', '101');
      expect(missingToken.status).toBe(400);
    } finally {
      if (previousRoot === undefined) delete process.env.UPLOADS_DIR;
      else process.env.UPLOADS_DIR = previousRoot;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
