import { describe, it, expect, beforeEach, jest } from '@jest/globals';

beforeEach(() => {
  // Ensure a fresh copy of the module for each test
  jest.resetModules();
});

// simple fake socket.io
function makeIoMock() {
  const emit = jest.fn();
  const room = { emit };
  const io = {
    to: jest.fn(() => room),
  };
  return { io, emit, room };
}

describe('maybeAutoRespondUsers (gating / early returns)', () => {
  it('returns early when chatRoomId is missing/invalid', async () => {
    const { maybeAutoRespondUsers } = await import('../autoResponder.js');

    const prisma = {
      participant: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();

    const savedMessage = {
      chatRoomId: 0, // invalid
      senderId: 1,
      sender: { id: 1 },
      rawContent: 'hello',
      isAutoReply: false,
    };

    await maybeAutoRespondUsers({ savedMessage, prisma, io });

    // Should bail before touching DB or IO
    expect(prisma.participant.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('returns early when senderId is missing/invalid', async () => {
    const { maybeAutoRespondUsers } = await import('../autoResponder.js');

    const prisma = {
      participant: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();

    const savedMessage = {
      chatRoomId: 123,
      senderId: 0, // invalid
      sender: { id: 0 },
      rawContent: 'hi there',
      isAutoReply: false,
    };

    await maybeAutoRespondUsers({ savedMessage, prisma, io });

    expect(prisma.participant.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('returns early when message is already an auto-reply', async () => {
    const { maybeAutoRespondUsers } = await import('../autoResponder.js');

    const prisma = {
      participant: { findMany: jest.fn() },
    };
    const { io } = makeIoMock();

    const savedMessage = {
      chatRoomId: 10,
      senderId: 1,
      sender: { id: 1 },
      rawContent: 'auto response',
      isAutoReply: true, // should short-circuit
    };

    await maybeAutoRespondUsers({ savedMessage, prisma, io });

    expect(prisma.participant.findMany).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('does nothing if there are no auto-responder candidates in the room', async () => {
    const { maybeAutoRespondUsers } = await import('../autoResponder.js');

    const roomId = 42;
    const senderId = 1;

    const prisma = {
      participant: {
        findMany: jest.fn().mockResolvedValue([
          {
            user: {
              id: senderId,
              username: 'sender',
              enableAIResponder: false,
              autoResponderMode: 'dm',
              autoResponderCooldownSec: null,
              autoResponderActiveUntil: null,
              autoResponderSignature: null,
            },
          },
          // No other participants with enableAIResponder = true
        ]),
      },
    };

    const { io, emit } = makeIoMock();

    const savedMessage = {
      chatRoomId: roomId,
      senderId,
      sender: { id: senderId },
      rawContent: 'Hello there',
      isAutoReply: false,
    };

    await maybeAutoRespondUsers({ savedMessage, prisma, io });

    // Participants were loaded
    expect(prisma.participant.findMany).toHaveBeenCalledWith({
      where: { chatRoomId: roomId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            enableAIResponder: true,
            autoResponderMode: true,
            autoResponderCooldownSec: true,
            autoResponderActiveUntil: true,
            autoResponderSignature: true,
          },
        },
      },
    });

    // But no auto-responses were sent
    expect(io.to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
