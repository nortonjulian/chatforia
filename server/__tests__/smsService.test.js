/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// ── Mock Twilio telco layer BEFORE importing service ─────────────────────────
const sendSmsMock = jest.fn(async ({ to, text, clientRef }) => ({
  provider: 'twilio',
  messageSid: `SM_${(to || '').replace(/\D/g, '')}_${Date.now()}`,
  _debug: { to, text, clientRef },
}));
jest.mock('../lib/telco/index.js', () => {
  return { __esModule: true, sendSms: (...args) => sendSmsMock(...args) };
});

// ── Imports after mocks ───────────────────────────────────────────────────────
import prisma from '../utils/prismaClient.js';
import {
  sendUserSms,
  recordInboundSms,
  listThreads,
  getThread,
} from '../services/smsService.js';

const E164_MY_NUMBER = '+15550001111';   // Chatforia DID assigned to the user
const E164_CONTACT   = '+15551234567';   // Contact’s phone

describe('smsService (Twilio-only)', () => {
  let userId;
  let threadId;

  beforeAll(async () => {
    // Create a user
    const user = await prisma.user.create({
      data: {
        email: `sms_${Date.now()}@example.com`,
        username: `sms_${Date.now()}`,
        passwordHash: 'test', // tests typically don’t validate real password flows here
        plan: 'FREE',
      },
      select: { id: true },
    });
    userId = user.id;

    // Create and assign a phone number to that user (status ASSIGNED)
    await prisma.phoneNumber.create({
      data: {
        e164: E164_MY_NUMBER,
        provider: 'twilio',
        status: 'ASSIGNED',
        assignedUserId: userId,
        assignedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    // Best-effort cleanup (order matters due FK)
    try {
      await prisma.smsMessage.deleteMany({ where: {} });
      await prisma.smsThread.deleteMany({ where: {} });
      await prisma.phoneNumber.deleteMany({ where: { assignedUserId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch (_) {
      // ignore
    }
  });

  test('sendUserSms() creates thread and outbound message (and calls Twilio mock)', async () => {
    sendSmsMock.mockClear();

    const res = await sendUserSms({
      userId,
      to: E164_CONTACT,
      body: 'hello from Chatforia',
    });

    expect(res.ok).toBe(true);
    expect(res.provider).toBe('twilio');
    expect(typeof res.messageSid === 'string' || res.messageSid === null).toBe(true);

    // Thread exists for (userId, E164_CONTACT)
    const thread = await prisma.smsThread.findFirst({
      where: { userId, contactPhone: E164_CONTACT },
    });
    expect(thread).toBeTruthy();
    threadId = thread.id;

    // Outbound message persisted
    const msgs = await prisma.smsMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toMatchObject({
      direction: 'out',
      fromNumber: E164_MY_NUMBER,
      toNumber: E164_CONTACT,
      body: 'hello from Chatforia',
      provider: 'twilio',
    });

    // Twilio sender called once with normalized params
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const callArgs = sendSmsMock.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      to: E164_CONTACT,
      text: 'hello from Chatforia',
    });
    expect(String(callArgs.clientRef || '')).toMatch(/^smsout:/);
  });

  test('recordInboundSms() appends inbound message to same thread', async () => {
    const saved = await recordInboundSms({
      toNumber: E164_MY_NUMBER,     // our DID
      fromNumber: E164_CONTACT,     // contact replies
      body: 'hi back 👋',
      provider: 'twilio',
    });

    expect(saved.ok).toBe(true);
    expect(saved.userId).toBe(userId);
    expect(saved.threadId).toBe(threadId);

    const msgs = await prisma.smsMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs.length).toBe(2);
    expect(msgs[1]).toMatchObject({
      direction: 'in',
      fromNumber: E164_CONTACT,
      toNumber: E164_MY_NUMBER,
      body: 'hi back 👋',
      provider: 'twilio',
    });
  });

  test('listThreads() returns the thread for the user', async () => {
    const threads = await listThreads(userId);
    expect(Array.isArray(threads)).toBe(true);
    expect(threads.some(t => t.id === threadId)).toBe(true);
  });

  test('getThread() returns the thread with messages in ascending order', async () => {
    const thread = await getThread(userId, threadId);
    expect(thread).toBeTruthy();
    expect(thread.id).toBe(threadId);
    expect(Array.isArray(thread.messages)).toBe(true);
    expect(thread.messages.length).toBe(2);
    // first is outbound, second is inbound
    expect(thread.messages[0].direction).toBe('out');
    expect(thread.messages[1].direction).toBe('in');
  });
});
