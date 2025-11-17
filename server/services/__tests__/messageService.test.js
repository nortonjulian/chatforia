import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';

// ----- Env (read at module load in messageService) ---------------------------

process.env.FORIA_BOT_USER_ID = '9999'; // some bot id that won't match sender
process.env.TRANSLATE_MAX_INPUT_CHARS = '1200';

// ----- Prisma mock -----------------------------------------------------------

const mockUserFindUnique = jest.fn();
const mockParticipantFindFirst = jest.fn();
const mockParticipantFindMany = jest.fn();
const mockMessageCreate = jest.fn();
const mockMessageUpdate = jest.fn();
const mockMessageKeyUpsert = jest.fn();
const mockChatRoomFindUnique = jest.fn();
const mockParticipantFindManyForAuto = jest.fn();
const mockTransaction = jest.fn(() => Promise.resolve());

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockUserFindUnique,
    },
    participant: {
      findFirst: mockParticipantFindFirst,
      findMany: (args) => {
        // We’ll branch on call site via a simple heuristic (chatRoom.findMany vs messageService auto)
        // In practice we can just use two separate mocks when we pass db explicitly.
        return mockParticipantFindMany(args);
      },
    },
    message: {
      create: mockMessageCreate,
      update: mockMessageUpdate,
    },
    messageKey: {
      upsert: mockMessageKeyUpsert,
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

// NOTE: We *don’t* need to mock ./botPlatform.js; dynamic import is wrapped in try/catch,
// so if it’s missing it will be swallowed. If you *do* have that file, this will still work.

// ----- Import service under test *after* mocks --------------------------------

const { createMessageService, maybeAutoTranslate } = await import('../messageService.js');

// ----- Timers for expiry tests ----------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

  jest.clearAllMocks();
  mockUserFindUnique.mockReset();
  mockParticipantFindFirst.mockReset();
  mockParticipantFindMany.mockReset();
  mockMessageCreate.mockReset();
  mockMessageUpdate.mockReset();
  mockMessageKeyUpsert.mockReset();
  mockChatRoomFindUnique.mockReset();
  mockParticipantFindManyForAuto.mockReset();
  mockTransaction.mockReset();
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
  it('runs full pipeline with FREE plan, clamps TTL, filters/translate/encrypt, writes message & keys', async () => {
    const senderId = 1;
    const chatRoomId = 77;
    const rawContent = 'Some bad words here';

    // Sender user
    mockUserFindUnique.mockResolvedValueOnce({
      id: senderId,
      username: 'alice',
      preferredLanguage: 'en',
      allowExplicitContent: false,
      autoDeleteSeconds: 3600, // default TTL
      publicKey: 'PUB1',
      plan: 'FREE',
    });

    // Membership check
    mockParticipantFindFirst.mockResolvedValueOnce({
      id: 10,
      chatRoomId,
      userId: senderId,
    });

    // Participants (sender + one recipient)
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
          allowExplicitContent: false, // disallows explicit
          publicKey: 'PUB2',
        },
      },
    ]);

    // Profanity + clean
    mockIsExplicit.mockReturnValueOnce(true);
    mockCleanText.mockReturnValueOnce('CLEAN_CONTENT');

    // Translation for targets
    mockTranslateForTargets.mockResolvedValueOnce({
      map: { fr: 'Bonjour propre' },
      from: 'en',
    });

    // Encryption
    mockEncryptMessageForParticipants.mockResolvedValueOnce({
      ciphertext: 'ciphertext123',
      encryptedKeys: { '1': 'encKey1', '2': 'encKey2' },
    });

    // Message create → saved message
    mockMessageCreate.mockResolvedValueOnce({
      id: 999,
      contentCiphertext: 'ciphertext123',
      encryptedKeys: { '1': 'encKey1', '2': 'encKey2' },
      translations: { fr: 'Bonjour propre' },
      translatedFrom: 'en',
      isExplicit: true,
      imageUrl: null,
      audioUrl: null,
      audioDurationSec: null,
      isAutoReply: false,
      expiresAt: null, // we don’t care here; we assert the *input* to create()
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
    });

    const result = await createMessageService({
      senderId,
      chatRoomId,
      content: rawContent,
      expireSeconds: 999999, // huge to trigger clamp for FREE
      imageUrl: null,
      audioUrl: null,
      audioDurationSec: null,
      isAutoReply: false,
      attachments: [],
    });

    // Membership + participants
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

    // Profanity filter + cleaning
    expect(mockIsExplicit).toHaveBeenCalledWith(rawContent);
    expect(mockCleanText).toHaveBeenCalledWith(rawContent);

    // Translation fan-out
    expect(mockTranslateForTargets).toHaveBeenCalledWith(
      'CLEAN_CONTENT',
      'en',
      ['fr'] // recipientExceptSender language
    );

    // Encryption
    expect(mockEncryptMessageForParticipants).toHaveBeenCalledWith(
      'CLEAN_CONTENT',
      expect.objectContaining({ id: senderId }),
      expect.arrayContaining([
        expect.objectContaining({ id: senderId }),
        expect.objectContaining({ id: 2 }),
      ])
    );

    // Expiry clamped for FREE plan:
    // FREE_MAX = 24h = 86400s, we set system time to 2025-01-01T00:00:00Z
    const messageArgs = mockMessageCreate.mock.calls[0][0];
    const expiresAt = messageArgs.data.expiresAt;
    const expectedExpires = new Date(
      new Date('2025-01-01T00:00:00.000Z').getTime() + 86400 * 1000
    );
    expect(expiresAt.getTime()).toBe(expectedExpires.getTime());

    // Raw content & translations & explicit flag
    expect(messageArgs.data.rawContent).toBe(rawContent);
    expect(messageArgs.data.translations).toEqual({ fr: 'Bonjour propre' });
    expect(messageArgs.data.translatedFrom).toBe('en');
    expect(messageArgs.data.isExplicit).toBe(true);

    // MessageKey upsert is called for each encrypted key
    expect(mockMessageKeyUpsert).toHaveBeenCalledTimes(2);

    const userIds = mockMessageKeyUpsert.mock.calls.map(
      (c) => c[0].where.messageId_userId.userId
    );
    expect(userIds.sort()).toEqual([1, 2]);

    // Returned payload includes chatRoomId and what we returned from create
    expect(result.id).toBe(999);
    expect(result.chatRoomId).toBe(chatRoomId);
    expect(result.encryptedKeys).toEqual({ '1': 'encKey1', '2': 'encKey2' });
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
      autoDeleteSeconds: 9999999, // huge default TTL
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
    mockEncryptMessageForParticipants.mockResolvedValueOnce({
      ciphertext: 'cipher-premium',
      encryptedKeys: { '5': 'encKey5' },
    });

    mockMessageCreate.mockResolvedValueOnce({
      id: 1000,
      contentCiphertext: 'cipher-premium',
      encryptedKeys: { '5': 'encKey5' },
      translations: null,
      translatedFrom: 'en',
      isExplicit: false,
      imageUrl: null,
      audioUrl: null,
      audioDurationSec: null,
      isAutoReply: false,
      expiresAt: null, // not used in assertion of input
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
    });

    await createMessageService({
      senderId,
      chatRoomId,
      content: rawContent,
      // expireSeconds omitted → use autoDeleteSeconds, then clamp by PREMIUM_MAX (7d)
    });

    const args = mockMessageCreate.mock.calls[0][0];
    const expiresAt = args.data.expiresAt;

    const PREMIUM_MAX = 7 * 24 * 3600; // 7 days in seconds
    const expectedExpires = new Date(
      new Date('2025-01-01T00:00:00.000Z').getTime() + PREMIUM_MAX * 1000
    );
    expect(expiresAt.getTime()).toBe(expectedExpires.getTime());
  });
});

// ============================================================================
// maybeAutoTranslate tests
// ============================================================================

describe('maybeAutoTranslate', () => {
  it('auto-translates when provider available, mode is on, and throttling allows', async () => {
    // Make provider available
    process.env.DEEPL_API_KEY = 'dummy-key';

    const roomId = 77;
    const savedMessage = {
      id: 555,
      chatRoomId: roomId,
      senderId: 1,
      rawContent: 'Hello world',
      content: '',
    };

    // Per-room and per-language token bucket allows
    mockAllow.mockImplementation((key) => {
      if (key === `translate:${roomId}`) return true;
      if (key === `translate:${roomId}:en`) return true;
      if (key === `translate:${roomId}:es`) return true;
      return false;
    });

    // Fake prismaArg with minimal shape
    const db = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({
          autoTranslateMode: 'on',
        }),
      },
      participant: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { user: { id: 1, preferredLanguage: 'en' } },
            { user: { id: 2, preferredLanguage: 'es' } },
          ]),
      },
      message: {
        update: jest.fn().mockResolvedValue({ id: 555 }),
      },
    };

    // translateText returns annotated text
    mockTranslateText.mockImplementation(async ({ text, targetLang }) => ({
      text: `[${targetLang}] ${text}`,
    }));

    await maybeAutoTranslate({ savedMessage, io: null, prisma: db });

    // Room lookup
    expect(db.chatRoom.findUnique).toHaveBeenCalledWith({
      where: { id: roomId },
      select: { autoTranslateMode: true },
    });

    // Participants fetched
    expect(db.participant.findMany).toHaveBeenCalledWith({
      where: { chatRoomId: roomId },
      include: { user: { select: { id: true, preferredLanguage: true } } },
    });

    // translateText should be called for "en" and "es"
    const langs = mockTranslateText.mock.calls.map((c) => c[0].targetLang).sort();
    expect(langs).toEqual(['en', 'es']);

    // Message updated with translations map
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
    // Ensure provider flags are not set
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

    // No DB calls or translateText when provider unavailable
    expect(db.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(db.participant.findMany).not.toHaveBeenCalled();
    expect(db.message.update).not.toHaveBeenCalled();
    expect(mockTranslateText).not.toHaveBeenCalled();
  });
});
