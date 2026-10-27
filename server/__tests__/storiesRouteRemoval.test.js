/** @jest-environment node */
import { describe, test, expect } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';

describe('abandoned Stories endpoint removal', () => {
  const app = createApp();

  test('the legacy Stories router is not mounted in the real application', () => {
    // Express 4 records mounted routes in its stack. This guards against
    // accidentally re-exposing the obsolete upload handler on app startup.
    const mountedStories = (app._router?.stack || [])
      .filter(layer => layer.name === 'router')
      .filter(layer => String(layer.regexp).includes('stories'));
    expect(mountedStories).toHaveLength(0);
  });

  test('normal application health endpoint remains available', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
