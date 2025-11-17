import { jest } from '@jest/globals';

// Ensure dev fallbacks are OFF so translation/encryption run
process.env.DEV_FALLBACKS = 'false';

// ---- Shared mocks ----
const mockPrisma = {
  contact: {
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  status: {
    create: jest.fn(),
  },
  statusKey: {
    upsert: jest.fn(),
  },
  $transaction: jest.fn(async (ops) => ops),
};

const isExplicitMock = jest.fn();
const cleanTextMock = jest.fn();
const translateForTargetsMock = jest.fn();
const encryptMessageForParticipantsMock = jest.fn();

// ---- Mock modules BEFORE importing the service ----
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

await jest.unstable_mockModule('../utils/filter.js', () => ({
  __esModule: true,
  isExplicit: isExplicitMock,
  cleanText: cleanTextMock,
}));

await jest.unstable_mockModule('../utils/translate.js', () => ({
  __esModule: true,
  translateForTargets: translateForTargetsMock,
}));

await jest.unstable_mockModule('../utils/encryption.js', () => ({
  __esModule: true,
  encryptMessageForParticipants: encryptMessageForParticipantsMock,
}));

// ---- Import functions under test ----
const { getAudienceUserIds, createStatusService } = await import('../statusService.js');

describe('getAudienceUserIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns deduped numeric ids for CUSTOM mode', async () => {
    const result = await getAudienceUserIds({
      authorId: 1,
      mode: 'CUSTOM',
      customIds: ['2', 2, 3, 0, null],
    });

    // Should not hit prisma.contact for CUSTOM
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([2, 3]);
  });

  it('returns mutuals when mode is MUTUALS', async () => {
    // First call: my contacts
    mockPrisma.contact.findMany
      .mockResolvedValueOnce([
        { userId: 2 },
        { userId: 3 },
      ])
      // Second call: reciprocals (only user 2 reciprocates)
      .mockResolvedValueOnce([
        { ownerId: 2 },
      ]);

    const result = await getAudienceUserIds({
      authorId: 1,
      mode: 'MUTUALS',
    });

    expect(mockPrisma.contact.findMany).toHaveBeenCalledTimes(2);

    // myContactIds = [2,3]; mutual set = {2} => [2]
    expect(result).toEqual([2]);
  });

  it('returns all contacts when mode is CONTACTS', async () => {
    mockPrisma.contact.findMany.mockResolvedValueOnce([
      { userId: 5 },
      { userId: 6 },
    ]);

    const result = await getAudienceUserIds({
      authorId: 10,
      mode: 'CONTACTS',
    });

    // Should only need one query
    expect(mockPrisma.contact.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([5, 6]);
  });
});

describe('createStatusService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a status with CUSTOM audience, translation, encryption, and status keys', async () => {
    const author = {
      id: 1,
      username: 'alice',
      preferredLanguage: 'en',
      allowExplicitContent: false,
      publicKey: 'pub1',
    };

    // Author lookup
    mockPrisma.user.findUnique.mockResolvedValue(author);

    // Audience users: author + 2 + 3
    const users = [
      author,
      {
        id: 2,
        username: 'bob',
        preferredLanguage: 'es',
        allowExplicitContent: true,
        publicKey: 'pub2',
      },
      {
        id: 3,
        username: 'carol',
        preferredLanguage: 'fr',
        allowExplicitContent: false,
        publicKey: 'pub3',
      },
    ];
    mockPrisma.user.findMany.mockResolvedValue(users);

    // Explicit content check + clean text
    isExplicitMock.mockReturnValue(true);
    cleanTextMock.mockImplementation((s) => `CLEAN:${s}`);

    // Translation: one translation per non-author user
    translateForTargetsMock.mockResolvedValue({
      map: {
        2: 'hola',
        3: 'salut',
      },
      from: 'en',
    });

    // Encryption: provide ciphertext + keys for author + user 2 only
    encryptMessageForParticipantsMock.mockResolvedValue({
      ciphertext: 'ENC',
      encryptedKeys: {
        1: 'k1',
        2: 'k2',
      },
    });

    // Status create: echo back data with an id
    mockPrisma.status.create.mockImplementation(async ({ data }) => ({
      id: 99,
      ...data,
      assets: [],
    }));

    const files = [
      {
        kind: 'image',
        url: 'https://cdn/status1.jpg',
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        caption: 'pic',
      },
    ];

    const result = await createStatusService({
      authorId: 1,
      caption: 'This is my raw caption',
      files,
      audience: 'CUSTOM',
      customAudienceIds: [2, 3],
      expireSeconds: 3600,
    });

    // Authors + users fetched
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        id: true,
        username: true,
        preferredLanguage: true,
        allowExplicitContent: true,
        publicKey: true,
      },
    });

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] } },
      select: {
        id: true,
        username: true,
        preferredLanguage: true,
        allowExplicitContent: true,
        publicKey: true,
      },
    });

    // Explicit & clean
    expect(isExplicitMock).toHaveBeenCalledWith('This is my raw caption');
    expect(cleanTextMock).toHaveBeenCalledWith('This is my raw caption');

    const expectedCaption = 'CLEAN:This is my raw caption';

    // Translation called with cleaned caption and target languages
    expect(translateForTargetsMock).toHaveBeenCalledWith(
      expectedCaption,
      'en',
      ['es', 'fr'],
    );

    // Encryption called with cleaned caption and full users list
    expect(encryptMessageForParticipantsMock).toHaveBeenCalledWith(
      expectedCaption,
      author,
      users,
    );

    // Status create called with expected data
    expect(mockPrisma.status.create).toHaveBeenCalledTimes(1);
    const createArg = mockPrisma.status.create.mock.calls[0][0];
    const data = createArg.data;

    expect(data.author).toEqual({ connect: { id: 1 } });
    expect(data.captionCiphertext).toBe('ENC');
    expect(data.audience).toBe('CUSTOM');
    expect(data.isExplicit).toBe(true);

    // Fallback key added for user 3 (self)
    expect(data.encryptedKeys).toEqual({
      1: 'k1',
      2: 'k2',
      3: 'self',
    });

    // Translations persisted
    expect(data.translations).toEqual({
      2: 'hola',
      3: 'salut',
    });
    expect(data.translatedFrom).toBe('en');

    // Assets normalized
    expect(data.assets).toEqual({
      createMany: {
        data: [
          {
            kind: 'image',
            url: 'https://cdn/status1.jpg',
            mimeType: 'image/jpeg',
            width: 800,
            height: 600,
            durationSec: null,
            caption: 'pic',
          },
        ],
      },
    });

    // ExpiresAt is a Date ~ 1h from now; we just assert it's a Date
    expect(data.expiresAt).toBeInstanceOf(Date);

    // Status keys transaction called with one upsert per key
    expect(mockPrisma.statusKey.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // Return value is what prisma.status.create returned
    expect(result.id).toBe(99);
    expect(result.captionCiphertext).toBe('ENC');
  });

  it('throws when there is no audience for non-EVERYONE status', async () => {
    const author = {
      id: 1,
      username: 'alice',
      preferredLanguage: 'en',
      allowExplicitContent: true,
      publicKey: 'pub1',
    };

    mockPrisma.user.findUnique.mockResolvedValue(author);

    // getAudienceUserIds (via CONTACT/MUTUALS) will see no contacts
    mockPrisma.contact.findMany.mockResolvedValue([]);

    await expect(
      createStatusService({
        authorId: 1,
        caption: 'hello',
        audience: 'MUTUALS',
      }),
    ).rejects.toThrow('No audience');

    expect(mockPrisma.status.create).not.toHaveBeenCalled();
  });

  it('throws on unsupported audience', async () => {
    const author = {
      id: 1,
      username: 'alice',
      preferredLanguage: 'en',
      allowExplicitContent: true,
      publicKey: 'pub1',
    };

    mockPrisma.user.findUnique.mockResolvedValue(author);

    await expect(
      createStatusService({
        authorId: 1,
        caption: 'hello',
        audience: 'WEIRD',
      }),
    ).rejects.toThrow('Unsupported audience: WEIRD');

    expect(mockPrisma.status.create).not.toHaveBeenCalled();
  });

  it('throws when author is not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      createStatusService({
        authorId: 999,
        caption: 'hello',
      }),
    ).rejects.toThrow('Author not found');

    expect(mockPrisma.status.create).not.toHaveBeenCalled();
  });
});
