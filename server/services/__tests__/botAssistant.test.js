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
