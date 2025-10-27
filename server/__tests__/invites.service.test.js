/** @jest-environment node */

import { jest } from '@jest/globals';

let prismaMock;
let sendSmsMock;
let createInvitesAndText;

beforeAll(async () => {
  // 1. mock prisma BEFORE importing the service
  jest.unstable_mockModule('../utils/prismaClient.js', () => {
    const event = {
      findUnique: jest.fn(),
    };
    const eventInvite = {
      create: jest.fn(),
      update: jest.fn(),
    };

    const prismaStub = {
      event,
      eventInvite,
    };

    return {
      __esModule: true,
      default: prismaStub,
      prisma: prismaStub,
    };
  });

  // 2. mock the FINAL Twilio layer BEFORE importing the service.
  // invites.js -> ../utils/sms.js -> ../lib/telco/index.js -> sendSms()
  // We mock that last one so nothing ever touches Twilio.
  jest.unstable_mockModule('../lib/telco/index.js', () => {
    return {
      __esModule: true,
      // matches the real named export
      sendSms: jest.fn(async ({ to, text, clientRef }) => ({
        provider: 'mock',
        messageSid: `SM_TEST_${to}`,
        to,
        text,
        clientRef,
      })),
      // if something in utils/sms.js imports default getProvider() or providerName etc,
      // it's safe to stub those too so it doesn't blow up.
      default: { providerName: 'mock' },
      getProvider: jest.fn(() => ({ providerName: 'mock' })),
      providerName: 'mock',
      providers: {},
    };
  });

  // 3. NOW import modules under test (after mocks are registered)
  const prismaModule = await import('../utils/prismaClient.js');
  const telcoModule = await import('../lib/telco/index.js');
  const invitesModule = await import('../services/invites.js');

  prismaMock = prismaModule.default;
  sendSmsMock = telcoModule.sendSms;
  createInvitesAndText = invitesModule.createInvitesAndText;
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('creates invites and sends SMS', async () => {
  // Arrange: fake event row
  prismaMock.event.findUnique.mockResolvedValueOnce({
    id: 'evt',
    title: 'Demo',
    location: 'Online',
    startUTC: new Date('2025-01-01T00:00:00Z'),
    endUTC: new Date('2025-01-01T01:00:00Z'),
  });

  // When invites.js calls prisma.eventInvite.create(...)
  prismaMock.eventInvite.create.mockImplementation(async ({ data }) => ({
    id: 'inv-' + data.phoneE164,
    ...data,
  }));

  // After SMS send, invites.js calls prisma.eventInvite.update(...)
  prismaMock.eventInvite.update.mockResolvedValue({});

  const recipients = [
    { phoneE164: '+15550001', name: 'A' },
    { phoneE164: '+15550002' },
  ];

  // Act
  const out = await createInvitesAndText({ eventId: 'evt', recipients });

  // Assert basic shape
  expect(out).toHaveLength(2);

  // We texted each recipient once
  expect(sendSmsMock).toHaveBeenCalledTimes(2);

  // We updated each invite (deliveredAt, etc.)
  expect(prismaMock.eventInvite.update).toHaveBeenCalledTimes(2);

  // (Optional deeper assertions)
  // expect(sendSmsMock).toHaveBeenCalledWith(
  //   expect.objectContaining({ to: '+15550001' })
  // );
});
