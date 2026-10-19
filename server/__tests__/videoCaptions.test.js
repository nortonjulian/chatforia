/** @jest-environment node */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const db = { user: { findUnique: jest.fn() }, call: { findFirst: jest.fn() } };
const provider = { start: jest.fn(), stop: jest.fn() };
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: db }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({ requireAuth: (req, res, next) => {
  if (!req.headers['x-user']) return res.sendStatus(401); req.user = { id: 65 }; next();
} }));
// Use the actual router and lifecycle service with an isolated external provider.
await jest.unstable_mockModule('../services/videoCaptionProvider.js', () => ({ createVideoCaptionProvider: () => provider }));
const { default: router } = await import('../routes/videoCaptions.js');
const app = express(); app.use(express.json()); app.use('/video', router);
const url = '/video/20/captions/qa-browser-session-00001';
const user = { id: 65, plan: 'PREMIUM', subscriptionStatus: 'ACTIVE', a11yLiveCaptions: true };
const start = () => request(app).post(url).set('x-user', '65').send({ sdp: 'v=0\r\nm=audio 9 RTP\r\n' });
beforeEach(() => {
  jest.clearAllMocks(); db.user.findUnique.mockResolvedValue(user);
  db.call.findFirst.mockResolvedValue({ id: 20, participants: [{ status: 'JOINED', leftAt: null }] });
  provider.start.mockResolvedValue({ id: 'rtc_qa', sdp: 'v=0\r\nanswer' }); provider.stop.mockResolvedValue();
});
afterEach(async () => { await request(app).delete(url).set('x-user', '65'); });
test('all routes require authentication', async () => {
  expect((await request(app).post(url)).status).toBe(401);
  expect((await request(app).post(`${url}/lease`)).status).toBe(401);
  expect((await request(app).delete(url)).status).toBe(401);
});
test('eligible participant gets the SDP answer and can renew and stop', async () => {
  const res = await start(); expect(res.status).toBe(200); expect(res.body).toEqual({ sdp: 'v=0\r\nanswer' });
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect((await request(app).post(`${url}/lease`).set('x-user', '65')).status).toBe(200);
  expect((await request(app).delete(url).set('x-user', '65')).status).toBe(200);
  expect(provider.stop).toHaveBeenCalledWith('rtc_qa');
});
test.each(['FREE', 'PLUS'])('%s account is blocked by the backend', async plan => {
  db.user.findUnique.mockResolvedValue({ ...user, plan }); expect((await start()).status).toBe(402); expect(provider.start).not.toHaveBeenCalled();
});
test('expired Premium is blocked', async () => {
  db.user.findUnique.mockResolvedValue({ ...user, subscriptionEndsAt: new Date(0) }); expect((await start()).status).toBe(402);
});
test('saved OFF preference prevents provider allocation', async () => {
  db.user.findUnique.mockResolvedValue({ ...user, a11yLiveCaptions: false }); expect((await start()).status).toBe(403); expect(provider.start).not.toHaveBeenCalled();
});
test('call authorization requires active video and participant membership', async () => {
  db.call.findFirst.mockResolvedValue(null); expect((await start()).status).toBe(403);
  expect(db.call.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 20, mode: 'VIDEO', status: 'ACTIVE', endedAt: null }) }));
  expect(provider.start).not.toHaveBeenCalled();
});
test('a video-bearing offer is rejected', async () => {
  const res = await request(app).post(url).set('x-user', '65').send({ sdp: 'v=0\r\nm=audio 9 RTP\r\nm=video 9 RTP\r\n' });
  expect(res.status).toBe(400); expect(provider.start).not.toHaveBeenCalled();
});
test('opt-out revokes an existing session on renewal', async () => {
  await start(); db.user.findUnique.mockResolvedValue({ ...user, a11yLiveCaptions: false });
  expect((await request(app).post(`${url}/lease`).set('x-user', '65')).status).toBe(403); expect(provider.stop).toHaveBeenCalledWith('rtc_qa');
});
test('provider failure is explicit and an ensuing retry is allowed', async () => {
  provider.start.mockRejectedValueOnce(new Error('no provider'));
  expect((await start()).status).toBe(503); expect((await start()).status).toBe(200);
});
