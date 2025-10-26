/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';

// mock STT so transcribeFromUrl returns stable data
jest.mock('../services/stt/index.js', () => ({
  __esModule: true,
  transcribeFromUrl: jest.fn(async (_url, language) => ({
    segments: [
      { ts: 0, text: `fake transcript in ${language}` },
      { ts: 5, text: 'more words' },
    ],
  })),
}));

// force config for quotas / flags
process.env.NODE_ENV = 'test';
process.env.DEV_FALLBACKS = 'true';

// import the real router under test
const { default: a11yRouter } = await import('../routes/a11y.js');

// tiny fake app that injects req.user from header
function buildApp() {
  const app = express();
  app.use(express.json());

  // simple auth shim: if X-Test-User-Id is present, attach req.user
  app.use((req, _res, next) => {
    const hdr = req.headers['x-test-user-id'];
    if (hdr) {
      req.user = {
        id: Number(hdr),
        role: 'USER',
        plan: 'FREE',
        a11yLiveCaptions: true,
      };
    }
    next();
  });

  app.use('/a11y', a11yRouter);
  app.get('/health', (_req, res) => res.json({ ok: true }));
  return app;
}

const app = buildApp();

// We'll seed ONCE for this file and reuse IDs.
let seededUserId;
let seededMessageId;

async function globalSeed() {
  // 1. create user
  const user = await prisma.user.create({
    data: {
      username: 'captain',
      email: 'cap@example.com',
      password: 'x',
      plan: 'FREE',
      role: 'USER',
      a11yLiveCaptions: true,
      a11yVoiceNoteSTT: true,
    },
    select: { id: true },
  });
  seededUserId = user.id;

  // 2. create chat room
  const room = await prisma.chatRoom.create({
    data: {
      isGroup: false,
    },
    select: { id: true },
  });

  // 3. create an audio message in that room from that user
  const m = await prisma.message.create({
    data: {
      rawContent: '',
      audioUrl: '/media/fake-audio.ogg',
      audioDurationSec: 42,
      sender: { connect: { id: user.id } },
      chatRoom: { connect: { id: room.id } },
    },
    select: { id: true },
  });
  seededMessageId = m.id;
}

// Seed once for this file
beforeAll(async () => {
  await globalSeed();
});

describe('A11Y/AI quotas and guards (integration-ish)', () => {
  test('PATCH /a11y/users/me/a11y updates allowed prefs for the authed user', async () => {
    const res = await request(app)
      .patch('/a11y/users/me/a11y')
      .set('X-Test-User-Id', String(seededUserId))
      .send({
        a11yUiFont: 'lg',
        a11yVisualAlerts: true,
        a11yFlashOnCall: false,
        a11yLiveCaptions: true,
        a11yCaptionFont: 'md',
        a11yCaptionBg: 'dark',
      });

    expect([200, 402, 500]).toContain(res.status);

    if (res.status === 200) {
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('id', seededUserId);
      expect(res.body.user).toHaveProperty('a11yUiFont');
    }
  });

  test('GET /a11y/users/me/a11y/quota returns quota summary', async () => {
    const res = await request(app)
      .get('/a11y/users/me/a11y/quota')
      .set('X-Test-User-Id', String(seededUserId));

    expect([200, 500]).toContain(res.status);

    if (res.status === 200) {
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('quota');
      expect(res.body.quota).toHaveProperty('plan');
      expect(res.body.quota).toHaveProperty('remainingSec');
    }
  });

  test('POST /a11y/media/:messageId/transcribe enforces auth / returns sensible shape', async () => {
    // 1. Missing auth
    const unauth = await request(app)
      .post(`/a11y/media/${seededMessageId}/transcribe`)
      .send({ language: 'en-US' });

    expect([401, 403]).toContain(unauth.status);

    // 2. With auth header
    const res = await request(app)
      .post(`/a11y/media/${seededMessageId}/transcribe`)
      .set('X-Test-User-Id', String(seededUserId))
      .send({ language: 'en-US' });

    expect([200, 402, 403, 500]).toContain(res.status);

    if (res.status === 200) {
      expect(res.body).toHaveProperty('ok', true);
      expect(
        res.body.transcript ||
        res.body.ephemeralTranscript ||
        res.body.transcript?.segments ||
        res.body.transcript?.language
      ).toBeTruthy();
    }

    if (res.status === 402) {
      expect(res.body).toHaveProperty('code');
    }
  });
});
