import { describe, it, expect, beforeEach, jest } from '@jest/globals';

beforeEach(() => {
  // Ensure each test gets a fresh copy of the module with fresh env reads
  jest.resetModules();
});

// Tiny helper for fake socket.io
function makeIoMock() {
  const emit = jest.fn();
  const room = { emit };
  const io = {
    to: jest.fn(() => room),
  };
  return { io, emit, room };
}

describe('maybeInvokeForiaBot (gating / early returns)', () => {
  it('returns early if BOT_ID is not configured (0)', async () => {
    // BOT_ID is derived from FORIA_BOT_USER_ID at module load
    process.env.FORIA_BOT_USER_ID = '0';
    process.env.OPENAI_API_KEY = 'test-key';

    const prisma = {
      chatRoom: { findUnique: jest.fn() },
      message: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();

    const { maybeInvokeForiaBot } = await import('../botAssistant.js');

    await maybeInvokeForiaBot({
      text: 'hello',
      savedMessage: { chatRoomId: 123, senderId: 10 },
      io,
      prisma,
    });

    // Should bail before touching DB or IO
    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

    it('returns early when OPENAI_API_KEY is missing', async () => {
    process.env.FORIA_BOT_USER_ID = '999'; // non-zero BOT_ID

    // Instead of delete process.env.OPENAI_API_KEY
    // force it to an empty string so the module sees it as "missing"
    process.env.OPENAI_API_KEY = '';

    const prisma = {
      chatRoom: { findUnique: jest.fn() },
      message: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();

    const { maybeInvokeForiaBot } = await import('../botAssistant.js');

    await maybeInvokeForiaBot({
      text: 'hello',
      savedMessage: { chatRoomId: 1, senderId: 10 },
      io,
      prisma,
    });

    // Still should bail before hitting DB or IO
    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });


  it('returns early when roomId is invalid (0)', async () => {
    process.env.FORIA_BOT_USER_ID = '999';
    process.env.OPENAI_API_KEY = 'test-key';

    const prisma = {
      chatRoom: { findUnique: jest.fn() },
      message: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();

    const { maybeInvokeForiaBot } = await import('../botAssistant.js');

    await maybeInvokeForiaBot({
      text: 'hi',
      savedMessage: { chatRoomId: 0, senderId: 10 }, // invalid room id
      io,
      prisma,
    });

    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('returns early when senderId is invalid (0)', async () => {
    process.env.FORIA_BOT_USER_ID = '999';
    process.env.OPENAI_API_KEY = 'test-key';

    const prisma = {
      chatRoom: { findUnique: jest.fn() },
      message: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();

    const { maybeInvokeForiaBot } = await import('../botAssistant.js');

    await maybeInvokeForiaBot({
      text: 'hi',
      savedMessage: { chatRoomId: 42, senderId: 0 }, // invalid sender
      io,
      prisma,
    });

    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('returns early when sender is the bot itself (avoid replying to self)', async () => {
    process.env.FORIA_BOT_USER_ID = '999';
    process.env.OPENAI_API_KEY = 'test-key';

    const prisma = {
      chatRoom: { findUnique: jest.fn() },
      message: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();

    const { maybeInvokeForiaBot } = await import('../botAssistant.js');

    await maybeInvokeForiaBot({
      text: 'hi from bot',
      savedMessage: {
        chatRoomId: 50,
        senderId: 999,        // same as BOT_ID
        sender: { id: 999 },
      },
      io,
      prisma,
    });

    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });
});

describe('maybeInvokeForiaBot (room sender consent)', () => {
  it('never treats legacy allowAIBot=true without affirmative timestamp as consent', async () => {
    process.env.FORIA_BOT_USER_ID = '999';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GROUP_RIA_ENABLED = 'true';
    const prisma = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({
          allowForiaBot: true,
          isGroup: true,
          aiAssistantMode: 'MENTION',
          participants: [
            { userId: 10, allowAIBot: true, riaGroupConsentedAt: null },
            { userId: 11, allowAIBot: true, riaGroupConsentedAt: new Date(), user: { strictE2EE: false } },
          ],
        }),
      },
      message: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();
    const { maybeInvokeForiaBot } = await import('../botAssistant.js');
    await maybeInvokeForiaBot({
      text: '@Ria please help', savedMessage: { id: 143, chatRoomId: 142, senderId: 10 }, io, prisma,
    });
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });


  it('never reads message context or sends to AI when sender has opted out', async () => {
    process.env.FORIA_BOT_USER_ID = '999';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GROUP_RIA_ENABLED = 'true';

    const prisma = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({
          allowForiaBot: true,
          isGroup: true,
          aiAssistantMode: 'MENTION',
          participants: [
            { userId: 10, allowAIBot: false, riaGroupConsentedAt: null, user: { username: 'sender', strictE2EE: false } },
            { userId: 11, allowAIBot: true, riaGroupConsentedAt: new Date(), user: { username: 'other', strictE2EE: false } },
          ],
        }),
      },
      message: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();
    const { maybeInvokeForiaBot } = await import('../botAssistant.js');

    await maybeInvokeForiaBot({
      text: '@Ria a private message that must not reach AI',
      savedMessage: { id: 154, chatRoomId: 135, senderId: 10 },
      io,
      prisma,
    });

    expect(prisma.chatRoom.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });
});

describe('group Ria E2EE and delivery safety', () => {
  const member = (userId, strictE2EE = false) => ({
    userId, allowAIBot: true, riaGroupConsentedAt: new Date(),
    user: { username: 'member', strictE2EE },
  });

  async function invoke({ participants, message, text = '@Ria explain this', enabled = true, mode = 'MENTION' }) {
    jest.resetModules();
    process.env.FORIA_BOT_USER_ID = '999';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GROUP_RIA_ENABLED = enabled ? 'true' : 'false';
    const prisma = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue({
        isGroup: true, allowForiaBot: true, aiAssistantMode: mode,
        participants: participants || [member(10), member(11)],
      }) },
      message: { findUnique: jest.fn().mockResolvedValue(message), findMany: jest.fn() },
    };
    const { io } = makeIoMock();
    const { maybeInvokeForiaBot } = await import('../botAssistant.js');
    await maybeInvokeForiaBot({
      text, savedMessage: { id: 25, chatRoomId: 42, senderId: 10 }, io, prisma,
    });
    return { prisma, io };
  }

  const stored = {
    chatRoomId: 42, senderId: 10, rawContent: '@Ria explain this',
    contentCiphertext: null, deletedForAll: false, isAutoReply: false,
    sender: { strictE2EE: false }, keys: [], payloads: [], sessionKeys: [],
  };

  it('does not access room data when feature flag is disabled', async () => {
    const { prisma } = await invoke({ enabled: false });
    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });

  it('does not access room data for ordinary group messages', async () => {
    const { prisma } = await invoke({ text: 'hello team' });
    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
  });

  it('rejects rooms with a strict-E2EE member before message lookup', async () => {
    const { prisma } = await invoke({ participants: [member(10), member(11, true)] });
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['ciphertext', { contentCiphertext: { ciphertext: 'secret' } }],
    ['encrypted keys', { keys: [{ messageId: 25 }] }],
    ['encrypted payloads', { payloads: [{ messageId: 25 }] }],
    ['session keys', { sessionKeys: [{ messageId: 25 }] }],
    ['strict sender', { sender: { strictE2EE: true } }],
    ['wrong sender', { senderId: 11 }],
    ['deleted message', { deletedForAll: true }],
    ['bot reply', { isAutoReply: true }],
  ])('rejects %s without reading history or emitting replies', async (_name, override) => {
    const { prisma, io } = await invoke({ message: { ...stored, ...override } });
    expect(prisma.message.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });
});
