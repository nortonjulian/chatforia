import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = {
  user: { findUnique: jest.fn() },
  call: { findFirst: jest.fn() },
  voicemail: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
};
const recordingSid = `RE${'a'.repeat(32)}`;
const saved = new Map();
const sendEmail = jest.fn(async () => true);
const transcribe = jest.fn(async () => undefined);
const emit = jest.fn();
const push = jest.fn(async () => undefined);
jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: prisma }));
jest.unstable_mockModule('../services/voicemailEmail.js', () => ({ sendVoicemailForwardEmail: sendEmail }));
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

beforeEach(() => {
  jest.clearAllMocks();
  saved.clear();
  prisma.user.findUnique.mockReset();
  prisma.user.findUnique.mockResolvedValue({ plan: 'PLUS', voicemailEmailForwardingEnabled: true, voicemailForwardEmail: 'saved@example.com' });
  sendEmail.mockReset();
  push.mockReset().mockResolvedValue(undefined);
  prisma.call.findFirst.mockResolvedValue(null);
  prisma.voicemail.create.mockImplementation(async ({ data }) => {
    if (saved.has(data.id)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    const row = { ...data, forwardedToEmailAt: null };
    saved.set(data.id, row);
    return row;
  });
  prisma.voicemail.findUnique.mockImplementation(async ({ where }) => saved.get(where.id) || null);
  prisma.voicemail.updateMany.mockImplementation(async ({ where, data }) => {
    const row = saved.get(where.id);
    if (!row || row.userId !== where.userId || row.forwardedToEmailAt) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  sendEmail.mockResolvedValue(true);
});

const callback = ({ sid = recordingSid, userId = 65, status = 'completed' } = {}) =>
  request(app).post('/webhooks/voice/voicemail/recording-status')
    .query({ userId, did: '+15551234567', from: '+15557654321' })
    .type('form').send({ RecordingSid: sid, RecordingStatus: status,
      RecordingUrl: 'https://api.twilio.com/recording', RecordingDuration: 10 });

async function eventually(assertion) {
  let failure;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw failure;
}

describe('voicemail recording callback delivery gate', () => {
  it.each([
    ['PLUS', true, true], ['PREMIUM', true, true],
    ['PLUS', false, false], ['FREE', true, false],
  ])('records voicemail for %s with email switch %s; sends email=%s', async (plan, enabled, sends) => {
    prisma.user.findUnique.mockResolvedValue({ plan, voicemailEmailForwardingEnabled: enabled, voicemailForwardEmail: 'saved@example.com' });
    await callback().expect(200);
    await eventually(() => expect(prisma.voicemail.create).toHaveBeenCalledTimes(1));
    expect(prisma.voicemail.create).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledWith(`twilio-${recordingSid}`);
    expect(emit).toHaveBeenCalledWith(65, 'voicemail:new', expect.any(Object));
    if (sends) await eventually(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(sendEmail).toHaveBeenCalledTimes(sends ? 1 : 0);
    if (sends) expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'saved@example.com' }));
  });

  it('accepts delayed completion after an earlier non-completed callback', async () => {
    await callback({ status: 'in-progress' }).expect(200);
    expect(prisma.voicemail.create).not.toHaveBeenCalled();
    await callback().expect(200);
    await eventually(() => expect(sendEmail).toHaveBeenCalledTimes(1));
  });

  it('emails the inbox link once when transcription finishes after recording delivery', async () => {
    let finishTranscription;
    transcribe.mockImplementationOnce(() => new Promise((resolve) => { finishTranscription = resolve; }));
    await callback().expect(200);
    await eventually(() => expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      voicemailId: `twilio-${recordingSid}`,
      transcript: null,
    })));
    await eventually(() => expect(saved.get(`twilio-${recordingSid}`).forwardedToEmailAt).toBeInstanceOf(Date));
    finishTranscription();
    await callback().expect(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate inbox, transcription, push, or email after successful delivery', async () => {
    await callback().expect(200);
    await eventually(() => expect(saved.get(`twilio-${recordingSid}`).forwardedToEmailAt).toBeInstanceOf(Date));
    await callback().expect(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(saved.size).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping callback deliveries within one API process', async () => {
    let confirmSend;
    sendEmail.mockImplementationOnce(() => new Promise((resolve) => { confirmSend = resolve; }));
    await Promise.all([callback().expect(200), callback().expect(200)]);
    await eventually(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(saved.size).toBe(1);
    confirmSend(true);
    await eventually(() => expect(saved.get(`twilio-${recordingSid}`).forwardedToEmailAt).toBeInstanceOf(Date));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('retains the inbox item and retries email after a provider failure', async () => {
    sendEmail.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await callback().expect(200);
    await eventually(() => expect(sendEmail).toHaveBeenCalledTimes(2));
    expect(saved.size).toBe(1);
    await eventually(() => expect(saved.get(`twilio-${recordingSid}`).forwardedToEmailAt).toBeInstanceOf(Date));
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(saved.get(`twilio-${recordingSid}`).forwardedToEmailAt).toBeInstanceOf(Date);
  });

  it('rejects a missing SID before storage or email', async () => {
    await callback({ sid: '' }).expect(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(prisma.voicemail.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not reuse another account recording on a conflicting SID', async () => {
    await callback().expect(200);
    await eventually(() => expect(saved.get(`twilio-${recordingSid}`).forwardedToEmailAt).toBeInstanceOf(Date));
    await callback({ userId: 66 }).expect(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(saved.size).toBe(1);
  });

  it('does not notify or email when storage fails after acknowledgment', async () => {
    prisma.voicemail.create.mockRejectedValueOnce(new Error('storage unavailable'));
    await callback().expect(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
