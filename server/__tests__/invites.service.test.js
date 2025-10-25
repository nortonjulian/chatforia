/** @jest-environment node */

import { jest } from '@jest/globals';

let prismaMock;
let sendSmsMock;
let createInvitesAndText;

beforeAll(async () => {
  // Mock prisma client module BEFORE importing the service
  jest.unstable_mockModule('../../server/utils/prismaClient.js', () => {
    const event = { findUnique: jest.fn() };
    const eventInvite = {
      create: jest.fn(),
      update: jest.fn(),
    };
    return {
      __esModule: true,
      default: {
        event,
        eventInvite,
      },
    };
  });

  // Mock SMS util BEFORE importing the service
  jest.unstable_mockModule('../../server/utils/sms.js', () => {
    return {
      __esModule: true,
      sendSms: jest.fn(async () => ({ ok: true })),
    };
  });

  // Now import the mocked modules and the service under test
  const prismaModule = await import('../../server/utils/prismaClient.js');
  const smsModule = await import('../../server/utils/sms.js');
  const invitesModule = await import('../../server/services/invites.js');

  prismaMock = prismaModule.default;
  sendSmsMock = smsModule.sendSms;
  createInvitesAndText = invitesModule.createInvitesAndText;
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('creates invites and sends SMS', async () => {
  // Arrange: set up prisma mock return values for this run
  prismaMock.event.findUnique.mockResolvedValueOnce({
    id: 'evt',
    title: 'Demo',
    location: 'Online',
    startUTC: new Date('2025-01-01T00:00:00Z'),
    endUTC: new Date('2025-01-01T01:00:00Z'),
  });

  prismaMock.eventInvite.create.mockImplementation(async ({ data }) => ({
    id: 'inv-' + data.phoneE164,
    ...data,
  }));

  prismaMock.eventInvite.update.mockResolvedValue({});

  const recipients = [
    { phoneE164: '+15550001', name: 'A' },
    { phoneE164: '+15550002' },
  ];

  // Act
  const out = await createInvitesAndText({ eventId: 'evt', recipients });

  // Assert
  expect(out).toHaveLength(2);

  // We texted each recipient once
  expect(sendSmsMock).toHaveBeenCalledTimes(2);

  // We updated each invite with delivery status/etc
  expect(prismaMock.eventInvite.update).toHaveBeenCalledTimes(2);

  // (optional deeper checks if you want — safe to skip but nice to have:)
  // expect(prismaMock.eventInvite.create).toHaveBeenCalledWith(
  //   expect.objectContaining({
  //     data: expect.objectContaining({ phoneE164: '+15550001' }),
  //   })
  // );
});
