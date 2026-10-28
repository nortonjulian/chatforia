/** @jest-environment node */
import { describe, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mountPublicAvatarFiles } from '../middleware/publicUploadAssets.js';

describe('public upload assets boundary', () => {
  test('public avatars remain accessible, private media/thumbnails/user keys never become static', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chatforia-assets-'));
    try {
      for (const [dir, name] of [
        ['avatars', 'public.png'],
        ['media', 'private.png'],
        ['thumbs', 'private-thumb.png'],
        ['user', 'private-document.png'],
      ]) {
        await fs.mkdir(path.join(root, dir), { recursive: true });
        await fs.writeFile(path.join(root, dir, name), 'test bytes');
      }

      const app = express();
      mountPublicAvatarFiles(app, { uploadsRoot: root });

      const avatar = await request(app).get('/uploads/avatars/public.png');
      expect(avatar.status).toBe(200);

      for (const url of [
        '/uploads/media/private.png',
        '/uploads/thumbs/private-thumb.png',
        '/uploads/user/private-document.png',
      ]) {
        const response = await request(app).get(url);
        expect(response.status).toBe(404);
        expect(response.text).not.toContain('test bytes');
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
