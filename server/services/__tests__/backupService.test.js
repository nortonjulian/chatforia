import { jest } from '@jest/globals';

// ---- 1. Build a shared prisma mock object ----
const mockPrisma = {
  user:            { findUnique: jest.fn() },
  device:          { findMany:  jest.fn() },
  contact:         { findMany:  jest.fn() },
  chatRoom:        { findMany:  jest.fn() },
  message:         { findMany:  jest.fn() },
  status:          { findMany:  jest.fn() },
  messageReaction: { findMany:  jest.fn() },
  statusView:      { findMany:  jest.fn() }, // optional table
};

// ---- 2. Mock the prismaClient module BEFORE importing backupService ----
//   Path is from THIS FILE: services/__tests__/ → up twice → utils/prismaClient.js
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// ---- 3. Now import the module under test (it will see the mocked prisma) ----
const { exportUserDataStream, respondWithUserBackup } = await import('../backupService.js');

// ---- 4. Helper to build a fake res stream ----
function createFakeRes() {
  const chunks = [];

  return {
    chunks,
    write: jest.fn((str) => {
      chunks.push(str);
      // simulate normal, non-backpressure behavior
      return true;
    }),
    once: jest.fn((event, handler) => {
      // Our write never returns false in tests, so 'drain' is never needed.
      // Still define so write()'s await new Promise(res.once('drain')) is safe.
      if (event === 'drain') handler();
    }),
    setHeader: jest.fn(),
    getBody: () => chunks.join(''),
  };
}

describe('exportUserDataStream', () => {
  const userId = 'user-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // profile
    mockPrisma.user.findUnique.mockResolvedValue({
      id: userId,
      username: 'testuser',
      email: 'test@example.com',
      phone: '+10000000000',
      plan: 'FREE',
      theme: 'dark',
      preferredLanguage: 'en',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    });

    // devices
    mockPrisma.device.findMany.mockResolvedValue([
      {
        id: 'dev-1',
        name: 'iPhone',
        platform: 'iOS',
        createdAt: new Date('2025-01-01T01:00:00.000Z'),
        lastSeenAt: new Date('2025-01-02T01:00:00.000Z'),
      },
    ]);

    // contacts
    mockPrisma.contact.findMany.mockResolvedValue([
      {
        id: 'contact-1',
        userId: 'friend-1',
        alias: 'Bestie',
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
      },
    ]);

    // chatrooms
    mockPrisma.chatRoom.findMany.mockResolvedValue([
      {
        id: 'room-1',
        name: 'Test Room',
        type: 'DIRECT',
        createdAt: new Date('2025-01-04T00:00:00.000Z'),
        participants: [{ id: userId }, { id: 'friend-1' }],
      },
    ]);

    // messages authored by user
    mockPrisma.message.findMany.mockResolvedValue([
      {
        id: 'msg-1',
        chatRoomId: 'room-1',
        createdAt: new Date('2025-01-05T00:00:00.000Z'),
        editedAt: null,
        deletedAt: null,
        kind: 'TEXT',
        content: 'Hello world',
        attachments: [
          {
            id: 'att-1',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 12345,
          },
        ],
      },
    ]);

    // statuses authored
    mockPrisma.status.findMany.mockResolvedValue([
      {
        id: 'status-1',
        audience: 'ALL',
        caption: 'My status',
        createdAt: new Date('2025-01-06T00:00:00.000Z'),
        expiresAt: new Date('2025-01-07T00:00:00.000Z'),
        media: [
          {
            id: 'media-1',
            filename: 'status.jpg',
            mimeType: 'image/jpeg',
            size: 9999,
          },
        ],
      },
    ]);

    // reactions
    mockPrisma.messageReaction.findMany.mockResolvedValue([
      {
        id: 'react-1',
        messageId: 'msg-1',
        emoji: '👍',
        createdAt: new Date('2025-01-08T00:00:00.000Z'),
      },
    ]);

    // status views
    mockPrisma.statusView.findMany.mockResolvedValue([
      {
        statusId: 'status-1',
        createdAt: new Date('2025-01-09T00:00:00.000Z'),
      },
    ]);
  });

  it('streams a valid JSON object with all expected top-level keys', async () => {
    const res = createFakeRes();

    await exportUserDataStream(res, userId);

    expect(res.write).toHaveBeenCalled();

    const body = res.getBody();
    const parsed = JSON.parse(body);

    expect(parsed).toEqual({
      profile: expect.objectContaining({
        id: userId,
        username: 'testuser',
      }),
      devices: expect.arrayContaining([
        expect.objectContaining({ id: 'dev-1' }),
      ]),
      contacts: expect.arrayContaining([
        expect.objectContaining({ id: 'contact-1' }),
      ]),
      chatrooms: expect.arrayContaining([
        expect.objectContaining({
          id: 'room-1',
          participantIds: expect.arrayContaining([userId, 'friend-1']),
        }),
      ]),
      messagesAuthored: expect.arrayContaining([
        expect.objectContaining({ id: 'msg-1' }),
      ]),
      statusesAuthored: expect.arrayContaining([
        expect.objectContaining({ id: 'status-1' }),
      ]),
      messageReactionsByUser: expect.arrayContaining([
        expect.objectContaining({ id: 'react-1' }),
      ]),
      statusViewsByUser: expect.arrayContaining([
        expect.objectContaining({ statusId: 'status-1' }),
      ]),
    });
  });

  it('gracefully handles missing statusView table (throws) and exports empty statusViewsByUser', async () => {
    const res = createFakeRes();

    // Make statusView.findMany throw to simulate optional table missing
    mockPrisma.statusView.findMany.mockRejectedValueOnce(
      new Error('statusView table does not exist'),
    );

    await exportUserDataStream(res, userId);

    const body = res.getBody();
    const parsed = JSON.parse(body);

    expect(parsed.statusViewsByUser).toEqual([]);
  });
});

describe('respondWithUserBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // For this test we don't care about actual data – just make sure queries don't blow up.
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.device.findMany.mockResolvedValue([]);
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.chatRoom.findMany.mockResolvedValue([]);
    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.status.findMany.mockResolvedValue([]);
    mockPrisma.messageReaction.findMany.mockResolvedValue([]);
    mockPrisma.statusView.findMany.mockResolvedValue([]);
  });

  it('sets correct headers and filename and then streams JSON', async () => {
    const res = createFakeRes();

    jest.useFakeTimers().setSystemTime(new Date('2025-01-02T10:20:30Z'));

    await respondWithUserBackup(res, 'user-xyz');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/json; charset=utf-8',
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="chatforia-backup-20250102.json"',
    );

    const body = res.getBody();
    const parsed = JSON.parse(body);

    expect(parsed).toHaveProperty('profile');
    expect(parsed).toHaveProperty('devices');
    expect(parsed).toHaveProperty('contacts');
    expect(parsed).toHaveProperty('chatrooms');
    expect(parsed).toHaveProperty('messagesAuthored');
    expect(parsed).toHaveProperty('statusesAuthored');
    expect(parsed).toHaveProperty('messageReactionsByUser');
    expect(parsed).toHaveProperty('statusViewsByUser');
  });

    it('allows overriding the filename base', async () => {
    const res = createFakeRes();

    // Freeze time at a known instant
    const fakeNow = new Date('2025-03-10T00:00:00Z');
    jest.useFakeTimers().setSystemTime(fakeNow);

    await respondWithUserBackup(res, 'user-xyz', 'my-custom-backup');

    // Build expected filename using the same logic as backupService
    const dt = new Date(); // this uses the faked system time
    const expectedName = `my-custom-backup-${dt.getFullYear()}${String(
        dt.getMonth() + 1,
    ).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}.json`;

    expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `attachment; filename="${expectedName}"`,
    );
    });
});
