/**
 * @jest-environment node
 */
import request from 'supertest';
import { createApp } from '../app.js';

const app = createApp();

describe('security headers & CSP', () => {
  test('GET / responds with secure headers', async () => {
    const res = await request(app).get('/').set('Accept', 'text/html');

    // Helmet / secure headers
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');

    // CSP present (value depends on nonce & env)
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/default-src 'self'/);
  });
});
