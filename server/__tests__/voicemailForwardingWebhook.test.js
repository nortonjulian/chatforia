import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = {
  user: { findUnique: jest.fn() },
  call: { findFirst: jest.fn() },
  voicemail: { create: jest.fn() },
};
const sendEmail = jest.fn(async () => undefined);
const transcribe = jest.fn(async () => undefined);
const emit = jest.fn();
jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: prisma }));
jest.unstable_mockModule('../services/voicemailEmail.js', () => ({ sendVoicemailForwardEmail: sendEmail }));
jest.unstable_mockModule('../services/voicemailTranscription.js', () => ({ enqueueVoicemailTranscription: transcribe }));
jest.unstable_mockModule('../services/socketBus.js', () => ({ emitToUser: emit }));
jest.unstable_mockModule('../utils/voicemailAudioAnalysis.js', () => ({
  analyzeTwilioVoicemailAudio: jest.fn(async () => ({})),
  isEffectivelySilentVoicemail: jest.fn(() => false),
}));
const { default: router } = await import('../routes/webhooksTwilio.js');
const app = express();
app.use('/webhooks', router);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.call.findFirst.mockResolvedValue(null);
  prisma.voicemail.create.mockImplementation(async ({ data }) => ({ id: 123, ...data }));
});

describe('voicemail recording callback delivery gate', () => {
  it.each([
    ['PLUS', true, true], ['PREMIUM', true, true],
    ['PLUS', false, false], ['FREE', true, false],
  ])('records voicemail for %s with email switch %s; sends email=%s', async (plan, enabled, sends) => {
    prisma.user.findUnique.mockResolvedValue({ plan, voicemailEmailForwardingEnabled: enabled, voicemailForwardEmail: 'saved@example.com' });
    // The callback acknowledges Twilio before doing work; wait for its inbox event.
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    emit.mockImplementation(() => finish());
    await request(app).post('/webhooks/voice/voicemail/recording-status')
      .query({ userId: 65, did: '+15551234567', from: '+15557654321' })
      .type('form').send({ RecordingStatus: 'completed', RecordingUrl: 'https://api.twilio.com/recording', RecordingDuration: 10 })
      .expect(200);
    await finished;
    expect(prisma.voicemail.create).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledWith(123);
    expect(emit).toHaveBeenCalledWith(65, 'voicemail:new', expect.any(Object));
    expect(sendEmail).toHaveBeenCalledTimes(sends ? 1 : 0);
    if (sends) expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'saved@example.com' }));
  });
});
