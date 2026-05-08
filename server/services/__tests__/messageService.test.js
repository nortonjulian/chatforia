import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';

// ----- Env (read at module load in messageService) ---------------------------

process.env.FORIA_BOT_USER_ID = '9999';
process.env.TRANSLATE_MAX_INPUT_CHARS = '1200';

// ----- Prisma mock -----------------------------------------------------------

const mockUserFindUnique = jest.fn();
const mockParticipantFindFirst = jest.fn();
const mockParticipantFindMany = jest.fn();
const mockMessageFindFirst = jest.fn();
const mockMessageCreate = jest.fn();
const mockMessageUpdate = jest.fn();
const mockMessageKeyCreateMany = jest.fn();
const mockChatRoomFindUnique = jest.fn();

const mockTransaction = jest.fn(async (callback) => {
  return callback({
    message: {
      create: mockMessageCreate,
    },
    messageKey: {
      createMany: mockMessageKeyCreateMany,
    },
  });
});

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockUserFindUnique,
    },
    participant: {
      findFirst: mockParticipantFindFirst,
      findMany: mockParticipantFindMany,
    },
    message: {
      findFirst: mockMessageFindFirst,
      create: mockMessageCreate,
      update: mockMessageUpdate,
    },
    messageKey: {
      createMany: mockMessageKeyCreateMany,
    },
    chatRoom: {
      findUnique: mockChatRoomFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

// ----- filter mocks ----------------------------------------------------------

const mockIsExplicit = jest.fn();
const mockCleanText = jest.fn();

jest.unstable_mockModule('../utils/filter.js', () => ({
  __esModule: true,
  isExplicit: mockIsExplicit,
  cleanText: mockCleanText,
}));

// ----- translateForTargets mock ---------------------------------------------

const mockTranslateForTargets = jest.fn();

jest.unstable_mockModule('../utils/translate.js', () => ({
  __esModule: true,
  translateForTargets: mockTranslateForTargets,
}));

// ----- encryption mock -------------------------------------------------------

const mockEncryptMessageForParticipants = jest.fn();

jest.unstable_mockModule('../utils/encryption.js', () => ({
  __esModule: true,
  encryptMessageForParticipants: mockEncryptMessageForParticipants,
}));

// ----- translateText + tokenBucket mocks ------------------------------------

const mockTranslateText = jest.fn();

jest.unstable_mockModule('../utils/translateText.js', () => ({
  __esModule: true,
  translateText: mockTranslateText,
}));

const mockAllow = jest.fn();

jest.unstable_mockModule('../utils/tokenBucket.js', () => ({
  __esModule: true,
  allow: mockAllow,
}));

// ----- socketBus mock --------------------------------------------------------

jest.unstable_mockModule('../services/socketBus.js', () => ({
  __esModule: true,
  setHelpers: jest.fn(),
}));

// ----- Import service under test *after* mocks -------------------------------

const { createMessageService, maybeAutoTranslate } = await import('../messageService.js');

// ----- Timers for expiry tests ----------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

  jest.clearAllMocks();

  mockUserFindUnique.mockReset();
  mockParticipantFindFirst.mockReset();
  mockParticipantFindMany.mockReset();
  mockMessageFindFirst.mockReset();
  mockMessageCreate.mockReset();
  mockMessageUpdate.mockReset();
  mockMessageKeyCreateMany.mockReset();
  mockChatRoomFindUnique.mockReset();
  mockTransaction.mockClear();

  mockIsExplicit.mockReset();
  mockCleanText.mockReset();
  mockTranslateForTargets.mockReset();
  mockEncryptMessageForParticipants.mockReset();
  mockTranslateText.mockReset();
  mockAllow.mockReset();
});

afterAll(() => {
  jest.useRealTimers();
});

// ============================================================================
// createMessageService tests
// ============================================================================

describe('createMessageService', () => {
  it('runs full pipeline with FREE plan, clamps TTL, filters/translate, writes message & keys', async () => {
    const senderId = 1;
    const chatRoomId = 77;
    const rawContent = 'Some bad words here';

    mockUserFindUnique.mockResolvedValueOnce({
      id: senderId,
      username: 'alice',
      preferredLanguage: 'en',
      allowExplicitContent: false,
      autoDeleteSeconds: 3600,
      publicKey: 'PUB1',
      plan: 'FREE',
    });

    mockParticipantFindFirst.mockResolvedValueOnce({
      id: 10,
      chatRoomId,
      userId: senderId,
    });

    mockParticipantFindMany.mockResolvedValueOnce([
      {
        user: {
          id: senderId,
          username: 'alice',
          preferredLanguage: 'en',
          allowExplicitContent: false,
          publicKey: 'PUB1',
        },
      },
      {
        user: {
          id: 2,
          username: 'bob',
          preferredLanguage: 'fr',
          allowExplicitContent: false,
          publicKey: 'PUB2',
        },
      },
    ]);

    mockIsExplicit.mockReturnValueOnce(true);
    mockCleanText.mockReturnValueOnce('CLEAN_CONTENT');

    mockTranslateForTargets.mockResolvedValueOnce({
      map: { fr: 'Bonjour propre' },
      from: 'en',
    });

    mockMessageCreate.mockResolvedValueOnce({
      id: 999,
      contentCiphertext: 'ciphertext123',
      translations: { fr: 'Bonjour propre' },
      translatedFrom: 'en',
      clientMessageId: null,
      isExplicit: true,
      imageUrl: null,
      audioUrl: null,
      audioDurationSec: null,
      isAutoReply: false,
      expiresAt: new Date(),
      createdAt: new Date(),
      senderId,
      sender: {
        id: senderId,
        username: 'alice',
        publicKey: 'PUB1',
        avatarUrl: null,
      },
      chatRoomId,
      rawContent,
      attachments: [],
      revision: 1,
    });

    const result = await createMessageService({
      senderId,
      chatRoomId,
      content: rawContent,
      contentCiphertext: 'ciphertext123',
      encryptedKeys: { '1': 'encKey1', '2': 'encKey2' },
      expireSeconds: 999999,
      imageUrl: null,
      audioUrl: null,
      audioDurationSec: null,
      isAutoReply: false,
      attachments: [],
    });

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: senderId },
      select: {
        id: true,
        username: true,
        preferredLanguage: true,
        allowExplicitContent: true,
        autoDeleteSeconds: true,
        publicKey: true,
        plan: true,
      },
    });

    expect(mockParticipantFindFirst).toHaveBeenCalledWith({
      where: { chatRoomId, userId: senderId },
    });

    expect(mockParticipantFindMany).toHaveBeenCalledWith({
      where: { chatRoomId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            preferredLanguage: true,
            allowExplicitContent: true,
            publicKey: true,
          },
        },
      },
    });

    expect(mockIsExplicit).toHaveBeenCalledWith(rawContent);
    expect(mockCleanText).toHaveBeenCalledWith(rawContent);

    expect(mockTranslateForTargets).toHaveBeenCalledWith(
      'CLEAN_CONTENT',
      'en',
      ['fr']
    );

    expect(mockEncryptMessageForParticipants).not.toHaveBeenCalled();

    const messageArgs = mockMessageCreate.mock.calls[0][0];
    const expiresAt = messageArgs.data.expiresAt;

    const expectedExpires = new Date(
      new Date('2025-01-01T00:00:00.000Z').getTime() + 86400 * 1000
    );

    expect(expiresAt.getTime()).toBe(expectedExpires.getTime());

    expect(messageArgs.data.contentCiphertext).toBe('ciphertext123');
    expect(messageArgs.data.rawContent).toBe(rawContent);
    expect(messageArgs.data.translations).toEqual({ fr: 'Bonjour propre' });
    expect(messageArgs.data.translatedFrom).toBe('en');
    expect(messageArgs.data.isExplicit).toBe(true);

    expect(mockMessageKeyCreateMany).toHaveBeenCalledTimes(1);
    expect(mockMessageKeyCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { messageId: 999, userId: 1, encryptedKey: 'encKey1' },
        { messageId: 999, userId: 2, encryptedKey: 'encKey2' },
      ]),
      skipDuplicates: true,
    });

    expect(result.id).toBe(999);
    expect(result.chatRoomId).toBe(chatRoomId);
    expect(result.contentCiphertext).toBe('ciphertext123');
  });

  it('uses user default TTL and PREMIUM max when expireSeconds is not provided', async () => {
    const senderId = 5;
    const chatRoomId = 42;
    const rawContent = 'Premium user message';

    mockUserFindUnique.mockResolvedValueOnce({
      id: senderId,
      username: 'prem',
      preferredLanguage: 'en',
      allowExplicitContent: true,
      autoDeleteSeconds: 9999999,
      publicKey: 'PUB5',
      plan: 'PREMIUM',
    });

    mockParticipantFindFirst.mockResolvedValueOnce({
      id: 11,
      chatRoomId,
      userId: senderId,
    });

    mockParticipantFindMany.mockResolvedValueOnce([
      {
        user: {
          id: senderId,
          username: 'prem',
          preferredLanguage: 'en',
          allowExplicitContent: true,
          publicKey: 'PUB5',
        },
      },
    ]);

    mockIsExplicit.mockReturnValueOnce(false);
    mockCleanText.mockImplementation((s) => s);

    mockTranslateForTargets.mockResolvedValueOnce({
      map: {},
      from: 'en',
    });

    mockMessageCreate.mockResolvedValueOnce({
      id: 1000,
      contentCiphertext: 'cipher-premium',
      translations: null,
      translatedFrom: 'en',
      clientMessageId: null,
      isExplicit: false,
      imageUrl: null,
      audioUrl: null,
      audioDurationSec: null,
      isAutoReply: false,
      expiresAt: new Date(),
      createdAt: new Date(),
      senderId,
      sender: {
        id: senderId,
        username: 'prem',
        publicKey: 'PUB5',
        avatarUrl: null,
      },
      chatRoomId,
      rawContent,
      attachments: [],
      revision: 1,
    });

    await createMessageService({
      senderId,
      chatRoomId,
      content: rawContent,
      contentCiphertext: 'cipher-premium',
      encryptedKeys: { '5': 'encKey5' },
    });

    const args = mockMessageCreate.mock.calls[0][0];
    const expiresAt = args.data.expiresAt;

    const PREMIUM_MAX = 7 * 24 * 3600;

    const expectedExpires = new Date(
      new Date('2025-01-01T00:00:00.000Z').getTime() +
        PREMIUM_MAX * 1000
    );

    expect(expiresAt.getTime()).toBe(expectedExpires.getTime());

    expect(mockMessageKeyCreateMany).toHaveBeenCalledWith({
      data: [{ messageId: 1000, userId: 5, encryptedKey: 'encKey5' }],
      skipDuplicates: true,
    });
  });
});

// ============================================================================
// maybeAutoTranslate tests
// ============================================================================

describe('maybeAutoTranslate', () => {
  it('auto-translates when provider available, mode is on, and throttling allows', async () => {
    process.env.DEEPL_API_KEY = 'dummy-key';

    const roomId = 77;

    const savedMessage = {
      id: 555,
      chatRoomId: roomId,
      senderId: 1,
      rawContent: 'Hello world',
      content: '',
    };

    mockAllow.mockImplementation((key) => {
      if (key === `translate:${roomId}`) return true;
      if (key === `translate:${roomId}:en`) return true;
      if (key === `translate:${roomId}:es`) return true;
      return false;
    });

    const db = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({
          autoTranslateMode: 'on',
        }),
      },
      participant: {
        findMany: jest.fn().mockResolvedValue([
          { user: { id: 1, preferredLanguage: 'en' } },
          { user: { id: 2, preferredLanguage: 'es' } },
        ]),
      },
      message: {
        update: jest.fn().mockResolvedValue({ id: 555 }),
      },
    };

    mockTranslateText.mockImplementation(async ({ text, targetLang }) => ({
      text: `[${targetLang}] ${text}`,
    }));

    await maybeAutoTranslate({ savedMessage, io: null, prisma: db });

    expect(db.chatRoom.findUnique).toHaveBeenCalledWith({
      where: { id: roomId },
      select: { autoTranslateMode: true },
    });

    expect(db.participant.findMany).toHaveBeenCalledWith({
      where: { chatRoomId: roomId },
      include: { user: { select: { id: true, preferredLanguage: true } } },
    });

    const langs = mockTranslateText.mock.calls
      .map((c) => c[0].targetLang)
      .sort();

    expect(langs).toEqual(['en', 'es']);

    expect(db.message.update).toHaveBeenCalledTimes(1);

    const updateArgs = db.message.update.mock.calls[0][0];

    expect(updateArgs.where).toEqual({ id: savedMessage.id });
    expect(updateArgs.data.translations).toEqual({
      en: '[en] Hello world',
      es: '[es] Hello world',
    });
    expect(updateArgs.select).toEqual({ id: true });
  });

  it('skips translation when provider is not available', async () => {
    delete process.env.DEEPL_API_KEY;
    delete process.env.TRANSLATE_ENDPOINT;

    const savedMessage = {
      id: 1,
      chatRoomId: 10,
      senderId: 3,
      rawContent: 'Hello',
      content: '',
    };

    const db = {
      chatRoom: { findUnique: jest.fn() },
      participant: { findMany: jest.fn() },
      message: { update: jest.fn() },
    };

    await maybeAutoTranslate({ savedMessage, io: null, prisma: db });

    expect(db.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(db.participant.findMany).not.toHaveBeenCalled();
    expect(db.message.update).not.toHaveBeenCalled();
    expect(mockTranslateText).not.toHaveBeenCalled();
  });
});