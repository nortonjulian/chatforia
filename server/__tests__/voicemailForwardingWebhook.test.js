import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const recordingSid = `RE${'a'.repeat(32)}`;
const voicemails = new Map();
const deliveries = new Map();
const prisma = {
  $transaction: jest.fn(),
  user: { findUnique: jest.fn() },
  call: { findFirst: jest.fn() },
  voicemail: { findUnique: jest.fn() },
};
const transcribe = jest.fn(async () => undefined);
const emit = jest.fn();
const push = jest.fn(async () => undefined);
jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: prisma }));
jest.unstable_mockModule('../services/voicemailTranscription.js', () => ({ enqueueVoicemailTranscription: transcribe }));
jest.unstable_mockModule('../services/socketBus.js', () => ({ emitToUser: emit }));
jest.unstable_mockModule('../services/pushService.js', () => ({ sendPushToUser: push }));
jest.unstable_mockModule('../utils/voicemailAudioAnalysis.js', () => ({
  analyzeTwilioVoicemailAudio: jest.fn(async () => ({})),
  isEffectivelySilentVoicemail: jest.fn(() => false),
}));
const { default: router } = await import('../routes/webhooksTwilio.js');
const app = express();
app.use('/webhooks', router);

const callback = ({ sid = recordingSid, userId = 65, status = 'completed' } = {}) =>
  request(app).post('/webhooks/voice/voicemail/recording-status')
    .query({ userId, did: '+15551234567', from: '+15557654321' })
    .type('form').send({ RecordingSid: sid, RecordingStatus: status,
      RecordingUrl: 'https://api.twilio.com/recording', RecordingDuration: 10 });

beforeEach(() => {
  jest.clearAllMocks();
  voicemails.clear();
  deliveries.clear();
  prisma.user.findUnique.mockReset().mockResolvedValue({
    plan: 'PLUS', voicemailEmailForwardingEnabled: true, voicemailForwardEmail: 'saved@example.com',
  });
  prisma.call.findFirst.mockResolvedValue(null);
  prisma.voicemail.findUnique.mockImplementation(async ({ where }) => voicemails.get(where.id) || null);
  prisma.$transaction.mockImplementation(async (fn) => {
    const pendingVoicemails = new Map(voicemails);
    const pendingDeliveries = new Map(deliveries);
    const tx = {
      voicemail: {
        findUnique: async ({ where }) => pendingVoicemails.get(where.id) || null,
        create: async ({ data }) => {
          if (pendingVoicemails.has(data.id)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
          const row = { ...data, forwardedToEmailAt: null };
          pendingVoicemails.set(data.id, row);
          return row;
        },
      },
      voicemailEmailDelivery: {
        create: async ({ data }) => {
          if (pendingDeliveries.has(data.voicemailId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
          pendingDeliveries.set(data.voicemailId, { ...data, status: 'PENDING', attempts: 0 });
        },
      },
    };
    const result = await fn(tx);
    voicemails.clear();
    deliveries.clear();
    pendingVoicemails.forEach((value, key) => voicemails.set(key, value));
    pendingDeliveries.forEach((value, key) => deliveries.set(key, value));
    return result;
  });
});

describe('voicemail recording callback persists delivery before acknowledgment', () => {
  it.each([
    ['PLUS', true, true], ['PREMIUM', true, true],
    ['PLUS', false, false], ['FREE', true, false],
  ])('saves voicemail for %s with email switch %s; queues=%s', async (plan, enabled, queues) => {
    prisma.user.findUnique.mockResolvedValue({ plan, voicemailEmailForwardingEnabled: enabled, voicemailForwardEmail: 'saved@example.com' });
    await callback().expect(200);
    expect(voicemails.size).toBe(1);
    expect(deliveries.size).toBe(queues ? 1 : 0);
    expect(transcribe).toHaveBeenCalledWith(`twilio-${recordingSid}`);
    expect(emit).toHaveBeenCalledWith(65, 'voicemail:new', expect.any(Object));
    if (queues) expect(deliveries.get(`twilio-${recordingSid}`)).toMatchObject({ recipient: 'saved@example.com', userId: 65 });
  });

  it('queues only on completed recording even after an earlier callback', async () => {
    await callback({ status: 'in-progress' }).expect(200);
    expect(voicemails.size).toBe(0);
    await callback().expect(200);
    expect(deliveries.size).toBe(1);
  });

  it('does not duplicate delivery, transcription, or inbox events on a callback retry', async () => {
    await callback().expect(200);
    await callback().expect(200);
    expect(voicemails.size).toBe(1);
    expect(deliveries.size).toBe(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('keeps delivery queued when transcription completes later', async () => {
    let finish;
    transcribe.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await callback().expect(200);
    expect(deliveries.size).toBe(1);
    finish();
    await callback().expect(200);
    expect(deliveries.size).toBe(1);
  });

  it('rolls back voicemail and returns 503 if the outbox write fails', async () => {
    prisma.$transaction.mockImplementationOnce(async (fn) => fn({
      voicemail: {
        findUnique: async () => null,
        create: async ({ data }) => ({ ...data }),
      },
      voicemailEmailDelivery: { create: async () => { throw new Error('outbox unavailable'); } },
    }));
    await callback().expect(503);
    expect(voicemails.size).toBe(0);
    expect(deliveries.size).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('returns 503 without side effects when database storage fails', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('storage unavailable'));
    await callback().expect(503);
    expect(voicemails.size).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('rejects missing recording SID before database work', async () => {
    await callback({ sid: '' }).expect(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not link a recording SID to another account', async () => {
    await callback().expect(200);
    await callback({ userId: 66 }).expect(409);
    expect(deliveries.size).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
