/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// Make sure webhooks are "on" before importing the module
process.env.BOT_WEBHOOKS_ENABLED = 'true';
process.env.BOT_ALLOWED_HOSTS = 'bots.allowed.com, *.example.com, localhost';

// Import the real prisma client and then stub its methods
const prismaModule = await import('../../utils/prismaClient.js');
const prisma = prismaModule.default;

// Import the module under test
const {
  parseAllowedHosts,
  shouldDispatchForContentScope,
  buildMessagePayload,
  enqueueBotEventsForMessage,
} = await import('../botPlatform.js');

describe('botPlatform.parseAllowedHosts', () => {
  test('parses comma-separated env into trimmed non-empty hosts', () => {
    const prev = process.env.BOT_ALLOWED_HOSTS;
    process.env.BOT_ALLOWED_HOSTS = ' bots.allowed.com , ,  *.example.com  , localhost ';

    const hosts = parseAllowedHosts();
    expect(hosts).toEqual(['bots.allowed.com', '*.example.com', 'localhost']);

    process.env.BOT_ALLOWED_HOSTS = prev;
  });

  test('returns empty array when env is empty or missing', () => {
    const prev = process.env.BOT_ALLOWED_HOSTS;
    delete process.env.BOT_ALLOWED_HOSTS;

    const hosts = parseAllowedHosts();
    expect(hosts).toEqual([]);

    process.env.BOT_ALLOWED_HOSTS = prev;
  });
});

describe('botPlatform.shouldDispatchForContentScope', () => {
  test('ALL always returns true for non-empty content', () => {
    expect(
      shouldDispatchForContentScope({
        scope: 'ALL',
        botName: 'ForiaBot',
        rawContent: 'hello there',
      }),
    ).toBe(true);
  });

  test('COMMANDS only matches messages starting with "/"', () => {
    expect(
      shouldDispatchForContentScope({
        scope: 'COMMANDS',
        botName: 'ForiaBot',
        rawContent: '/start something',
      }),
    ).toBe(true);

    expect(
      shouldDispatchForContentScope({
        scope: 'COMMANDS',
        botName: 'ForiaBot',
        rawContent: 'not a command',
      }),
    ).toBe(false);
  });

  test('MENTIONS matches @botName case-insensitively and is safe for regex', () => {
    expect(
      shouldDispatchForContentScope({
        scope: 'MENTIONS',
        botName: 'Foria.Bot+1',
        rawContent: 'Hello @foria.bot+1, please help',
      }),
    ).toBe(true);

    expect(
      shouldDispatchForContentScope({
        scope: 'MENTIONS',
        botName: 'ForiaBot',
        rawContent: 'no mention here',
      }),
    ).toBe(false);

    // no botName -> false
    expect(
      shouldDispatchForContentScope({
        scope: 'MENTIONS',
        botName: '',
        rawContent: '@someone',
      }),
    ).toBe(false);
  });

  test('returns false for empty content or unknown scope', () => {
    expect(
      shouldDispatchForContentScope({
        scope: 'ALL',
        botName: 'ForiaBot',
        rawContent: '   ',
      }),
    ).toBe(false);

    expect(
      shouldDispatchForContentScope({
        scope: 'UNKNOWN',
        botName: 'ForiaBot',
        rawContent: 'hello',
      }),
    ).toBe(false);
  });
});

describe('botPlatform.buildMessagePayload', () => {
  test('builds minimal payload and maps attachments correctly', () => {
    const install = { id: 'inst1', contentScope: 'ALL' };
    const bot = { id: 'b1', name: 'ForiaBot' };
    const message = {
      id: 'm1',
      chatRoomId: 'room123',
      rawContent: 'hello world',
      senderId: 42,
      sender: { id: 42, username: 'alice' },
      attachments: [
        {
          id: 'a1',
          kind: 'image',
          url: 'https://cdn.example.com/img.png',
          mimeType: 'image/png',
          width: 100,
          height: 200,
          durationSec: null,
          caption: 'an image',
        },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    const payload = buildMessagePayload({ install, bot, message });

    expect(payload).toMatchObject({
      type: 'message.created',
      installId: 'inst1',
      bot: { id: 'b1', name: 'ForiaBot' },
      chat: { id: 'room123' },
      message: {
        id: 'm1',
        content: 'hello world',
        sender: { id: 42, username: 'alice' },
        attachments: [
          {
            id: 'a1',
            kind: 'image',
            url: 'https://cdn.example.com/img.png',
            mimeType: 'image/png',
            width: 100,
            height: 200,
            durationSec: null,
            caption: 'an image',
          },
        ],
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      meta: {
        contentScope: 'ALL',
      },
    });

    // meta.timestamp should be "now-ish"
    expect(typeof payload.meta.timestamp).toBe('number');
  });
});

describe('botPlatform.enqueueBotEventsForMessage', () => {
  beforeEach(() => {
    // stub prisma methods fresh each test
    prisma.botInstall = {
      findMany: jest.fn(),
    };
    prisma.botEventLog = {
      create: jest.fn(),
      update: jest.fn(),
    };
  });

  test('queues events only for allowed https hosts and matching content scope', async () => {
    const savedMessage = {
      id: 'm1',
      chatRoomId: 'room123',
      rawContent: '/start hello',
      senderId: 42,
      sender: { id: 42, username: 'alice' },
      attachments: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    prisma.botInstall.findMany.mockResolvedValue([
      // ✅ should be queued: https + allowed host + COMMANDS + content starts with "/"
      {
        id: 'inst-ok',
        chatRoomId: 'room123',
        isEnabled: true,
        contentScope: 'COMMANDS',
        bot: {
          id: 'b1',
          name: 'ForiaBot',
          url: 'https://bots.allowed.com/webhook',
          secret: 'shh',
        },
      },
      // ❌ disallowed: http (and not localhost)
      {
        id: 'inst-http',
        chatRoomId: 'room123',
        isEnabled: true,
        contentScope: 'ALL',
        bot: {
          id: 'b2',
          name: 'ForiaBot',
          url: 'http://bots.allowed.com/webhook',
          secret: 'shh',
        },
      },
      // ❌ disallowed: host not in BOT_ALLOWED_HOSTS
      {
        id: 'inst-host',
        chatRoomId: 'room123',
        isEnabled: true,
        contentScope: 'ALL',
        bot: {
          id: 'b3',
          name: 'ForiaBot',
          url: 'https://evil.com/webhook',
          secret: 'shh',
        },
      },
      // ❌ disallowed: contentScope COMMANDS but message not a command
      {
        id: 'inst-scope',
        chatRoomId: 'room123',
        isEnabled: true,
        contentScope: 'MENTIONS',
        bot: {
          id: 'b4',
          name: 'ForiaBot',
          url: 'https://bots.allowed.com/webhook',
          secret: 'shh',
        },
      },
    ]);

    prisma.botEventLog.create.mockResolvedValue({
      id: 'log1',
      eventId: 'evt-123',
    });

    prisma.botEventLog.update.mockResolvedValue({});

    const queuedCount = await enqueueBotEventsForMessage(savedMessage);

    // only the first install should have produced a log
    expect(queuedCount).toBe(1);

    expect(prisma.botInstall.findMany).toHaveBeenCalledWith({
      where: { chatRoomId: 'room123', isEnabled: true },
      include: {
        bot: { select: { id: true, name: true, url: true, secret: true } },
      },
    });

    expect(prisma.botEventLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.botEventLog.create).toHaveBeenCalledWith({
      data: {
        installId: 'inst-ok',
        type: 'message.created',
        payload: expect.objectContaining({
          type: 'message.created',
          installId: 'inst-ok',
          bot: { id: 'b1', name: 'ForiaBot' },
        }),
        status: 'pending',
        nextAttemptAt: expect.any(Date),
      },
    });

    expect(prisma.botEventLog.update).toHaveBeenCalledTimes(1);
    expect(prisma.botEventLog.update).toHaveBeenCalledWith({
      where: { id: 'log1' },
      data: {
        payload: expect.objectContaining({
          eventId: 'evt-123',
        }),
      },
    });
  });

  test('returns undefined when no installs are enabled', async () => {
    prisma.botInstall.findMany.mockResolvedValue([]);

    const result = await enqueueBotEventsForMessage({
      id: 'm1',
      chatRoomId: 'room123',
      rawContent: 'hello',
    });

    expect(result).toBeUndefined();
    expect(prisma.botEventLog.create).not.toHaveBeenCalled();
  });
});
