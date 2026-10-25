import { describe, expect, jest, test } from '@jest/globals';
import {
  authorizeGroupRiaInvocation,
  GroupRiaInvocationError,
} from '../groupRiaInvocationContract.js';

const members = () => [
  { userId: 10, allowAIBot: true, riaGroupConsentedAt: new Date(), user: { strictE2EE: false } },
  { userId: 11, allowAIBot: true, riaGroupConsentedAt: new Date(), user: { strictE2EE: false } },
  { userId: 99, allowAIBot: false, riaGroupConsentedAt: null, user: { strictE2EE: false } },
];

const room = () => ({
  isGroup: true,
  allowForiaBot: true,
  aiAssistantMode: 'MENTION',
  participants: members(),
});

function fixture(overrides = {}) {
  const prisma = {
    chatRoom: { findUnique: jest.fn(async () => room()) },
  };
  return {
    prisma,
    enabled: true,
    providerReady: true,
    botId: 99,
    senderId: 10,
    body: {
      chatRoomId: 42,
      clientMessageId: 'ria-v1:abcdef1234567890',
      content: '@Ria hello',
      riaInvocation: { version: 1, acknowledgePlaintext: true },
    },
    ...overrides,
  };
}

async function rejects(base, code, status) {
  try {
    await authorizeGroupRiaInvocation(base);
    throw new Error('Expected Group Ria preflight rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(GroupRiaInvocationError);
    expect(err.code).toBe(code);
    if (status) expect(err.status).toBe(status);
  }
}

describe('explicit plaintext Group Ria pre-persistence authorization', () => {
  test('permits valid, affirmative @Ria and /ask invocations', async () => {
    for (const content of ['@Ria hello', '/ask hello']) {
      const input = fixture();
      input.body.content = content;
      await expect(authorizeGroupRiaInvocation(input)).resolves.toMatchObject({
        roomId: 42, senderId: 10, botId: 99, content,
      });
      expect(input.prisma.chatRoom.findUnique).toHaveBeenCalledTimes(1);
    }
  });

  test('rejects while the feature flag is off without a database lookup', async () => {
    const input = fixture({ enabled: false });
    await rejects(input, 'GROUP_RIA_DISABLED', 404);
    expect(input.prisma.chatRoom.findUnique).not.toHaveBeenCalled();
  });

  test.each([
    ['missing declaration', undefined],
    ['boolean only', true],
    ['missing acknowledgment', { version: 1 }],
    ['wrong version', { version: 2, acknowledgePlaintext: true }],
    ['not explicitly true', { version: 1, acknowledgePlaintext: 'true' }],
    ['extra declaration fields', { version: 1, acknowledgePlaintext: true, implicit: true }],
  ])('rejects %s before consulting the room', async (_name, intent) => {
    const input = fixture();
    input.body.riaInvocation = intent;
    await rejects(input, 'EXPLICIT_RIA_ACKNOWLEDGMENT_REQUIRED', 400);
    expect(input.prisma.chatRoom.findUnique).not.toHaveBeenCalled();
  });

  test.each([
    ['encryptedPayloads', null],
    ['contentCiphertext', 'opaque'],
    ['encryptedKeys', {}],
    ['attachmentsInline', []],
    ['expireSeconds', 30],
    ['text', '@Ria hello'],
  ])('rejects unexpected field %s (even when null)', async (field, value) => {
    const input = fixture();
    input.body[field] = value;
    await rejects(input, 'INVALID_RIA_REQUEST_FIELDS', 400);
    expect(input.prisma.chatRoom.findUnique).not.toHaveBeenCalled();
  });

  test.each(['hello', '@Ria', '/ask', '', ' @Ria hello ', '@Ria ' + 'x'.repeat(1500)])(
    'rejects nonqualifying prompt or overlong text', async (content) => {
      const input = fixture();
      input.body.content = content;
      await rejects(input, 'INVALID_RIA_PROMPT', 400);
      expect(input.prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    }
  );

  test.each(['ordinary-message-id', 'ria-v1:short', 'ria-v1:abcdef1234567890 space', null])(
    'requires dedicated idempotency namespace', async (id) => {
      const input = fixture();
      input.body.clientMessageId = id;
      await rejects(input, 'INVALID_RIA_CLIENT_MESSAGE_ID', 400);
    }
  );

  test('rejects when no AI provider is configured', async () => {
    await rejects(fixture({ providerReady: false }), 'GROUP_RIA_UNAVAILABLE', 503);
  });

  test.each([
    ['not a group', { isGroup: false }, 'GROUP_RIA_NOT_ALLOWED'],
    ['room toggle off', { allowForiaBot: false }, 'GROUP_RIA_NOT_ALLOWED'],
    ['ALWAYS mode prohibited', { aiAssistantMode: 'ALWAYS' }, 'GROUP_RIA_NOT_ALLOWED'],
    ['room missing', null, 'GROUP_RIA_NOT_ALLOWED'],
  ])('rejects %s', async (_label, value, code) => {
    const input = fixture();
    input.prisma.chatRoom.findUnique.mockResolvedValue(value === null ? null : { ...room(), ...value });
    await rejects(input, code);
  });

  test('requires a real bot room participant', async () => {
    const input = fixture();
    input.prisma.chatRoom.findUnique.mockResolvedValue({
      ...room(), participants: members().filter((m) => m.userId !== 99),
    });
    await rejects(input, 'GROUP_RIA_BOT_NOT_IN_ROOM');
  });

  test.each([10, 11, 99])('rejects any Strict-E2EE participant (id %i)', async (id) => {
    const input = fixture();
    const participants = members().map((m) => m.userId === id ?
      { ...m, user: { strictE2EE: true } } : m);
    input.prisma.chatRoom.findUnique.mockResolvedValue({ ...room(), participants });
    await rejects(input, 'GROUP_RIA_STRICT_E2EE_OR_UNAVAILABLE');
  });

  test('requires affirmative sender consent timestamp (not legacy allowAIBot)', async () => {
    const input = fixture();
    const participants = members().map((m) =>
      m.userId === 10 ? { ...m, riaGroupConsentedAt: null } : m);
    input.prisma.chatRoom.findUnique.mockResolvedValue({ ...room(), participants });
    await rejects(input, 'GROUP_RIA_SENDER_NOT_CONSENTED');
  });

  test('requires consent from another human, not the bot', async () => {
    const input = fixture();
    const participants = members().map((m) =>
      m.userId === 11 ? { ...m, riaGroupConsentedAt: null } : m);
    input.prisma.chatRoom.findUnique.mockResolvedValue({ ...room(), participants });
    await rejects(input, 'GROUP_RIA_SECOND_CONSENT_MISSING');
  });

  test('rejects when sender is not a member', async () => {
    await rejects(fixture({ senderId: 20 }), 'GROUP_RIA_SENDER_NOT_CONSENTED');
  });

  test('never returns room history or user-private fields', async () => {
    const approved = await authorizeGroupRiaInvocation(fixture());
    expect(Object.keys(approved).sort()).toEqual([
      'botId', 'clientMessageId', 'content', 'roomId', 'senderId',
    ]);
  });
});
