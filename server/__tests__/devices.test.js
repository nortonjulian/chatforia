import request from 'supertest';
import { createApp } from '../app.js';
import prisma from '../utils/prismaClient.js';

let app;
let agent;

beforeAll(async () => {
  app = createApp();
  agent = request.agent(app);

  const register = await agent.post('/auth/register').send({
    username: 'eve',
    email: 'e@example.com',
    password: 'hunter22',
  });

  expect([200, 201, 409]).toContain(register.status);

  await prisma.user.updateMany({
    where: { email: 'e@example.com' },
    data: {
      emailVerifiedAt: new Date(),
    },
  });

  const login = await agent.post('/auth/login').send({
    identifier: 'e@example.com',
    password: 'hunter22',
  });

  expect(login.status).toBe(200);
});

describe('Device limit', () => {
  test('second device for FREE returns 402', async () => {
    const first = await agent.post('/devices/register').send({
      deviceId: 'device-laptop',
      name: 'Laptop',
      platform: 'Web',
      publicKey: 'mock-public-key-1',
    });

    expect(first.status).toBe(200);

    const second = await agent.post('/devices/register').send({
      deviceId: 'device-desktop',
      name: 'Desktop',
      platform: 'Web',
      publicKey: 'mock-public-key-2',
    });

    expect([402, 403]).toContain(second.status);
  });
});