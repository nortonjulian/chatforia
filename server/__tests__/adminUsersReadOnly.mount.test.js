/** @jest-environment node */
import { test, expect } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';

const app = createApp();

test('actual application mounts protected Users API', async () => {
  const res = await request(app).get('/admin/users');

  expect(res.status).toBe(401);
  expect(res.body).not.toEqual({
    error: 'Not Found',
  });
});

test('actual application does not expose Users role changes', async () => {
  const res = await request(app)
    .patch('/admin/users/7/role')
    .send({ role: 'ADMIN' });

  expect([401, 404]).toContain(res.status);
});

test('actual application does not expose Users deletion', async () => {
  const res = await request(app)
    .delete('/admin/users/7');

  expect([401, 404]).toContain(res.status);
});
