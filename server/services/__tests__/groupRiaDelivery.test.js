import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const enqueue = jest.fn(async ({ fn }) => fn());
const allow = jest.fn(() => true);
const generate = jest.fn(async () => 'Ria response');
const create = jest.fn(async () => ({ id: 99 }));
const shape = jest.fn(async (id, userId) => ({ id, senderId: 999, viewerId: userId }));
const emit = jest.fn();
const members = (consented = true) => [
  { userId: 10, allowAIBot: true, riaGroupConsentedAt: consented ? new Date() : null, user: { strictE2EE: false } },
  { userId: 11, allowAIBot: true, riaGroupConsentedAt: new Date(), user: { strictE2EE: false } },
  { userId: 999, allowAIBot: false, riaGroupConsentedAt: null, user: { strictE2EE: false } },
];
const saved = { id: 25, chatRoomId: 42, senderId: 10, rawContent: '@Ria help', isAutoReply: false };
const persisted = {
  ...saved, contentCiphertext: null, deletedForAll: false,
  sender: { strictE2EE: false }, keys: [], payloads: [], sessionKeys: [],
};
const room = (participants = members()) => ({
  isGroup: true, allowForiaBot: true, aiAssistantMode: 'MENTION', participants,
});

jest.unstable_mockModule('../aiQueue.js', () => ({ enqueueAI: enqueue }));
jest.unstable_mockModule('../../utils/tokenBucket.js', () => ({ allow }));
jest.unstable_mockModule('../groupRiaProvider.js', () => ({ generateGroupRiaReply: generate }));
jest.unstable_mockModule('../messageService.js', () => ({
  createMessageService: create, shapeMessageForUser: shape,
}));
jest.unstable_mockModule('../socketBus.js', () => ({ emitMessageUpsertToUser: emit }));

process.env.FORIA_BOT_USER_ID = '999';
const { maybeInvokeForiaBot } = await import('../botAssistant.js');

function db({ participants = members(), message = persisted, duplicate = false } = {}) {
  return {
    chatRoom: { findUnique: jest.fn(async () => room(participants)) },
    message: { findUnique: jest.fn(async () => message) },
    groupRiaInvocation: {
      create: jest.fn(async () => { if (duplicate) throw { code: 'P2002' }; }),
      update: jest.fn(async () => {}),
    },
    participant: { findMany: jest.fn(async () => [{ userId: 10 }, { userId: 11 }, { userId: 999 }]) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-only-key';
  process.env.GROUP_RIA_ENABLED = 'true';
});

describe('group Ria gated integration', () => {
  it('stays inert when OFF', async () => {
    process.env.GROUP_RIA_ENABLED = 'false';
    const prisma = db();
    await maybeInvokeForiaBot({ text: '@Ria help', savedMessage: saved, prisma });
    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it('ignores ordinary messages', async () => {
    const prisma = db();
    await maybeInvokeForiaBot({ text: 'hi all', savedMessage: saved, prisma });
    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
  });
  it('requires consent instead of legacy defaults', async () => {
    const prisma = db({ participants: members(false) });
    await maybeInvokeForiaBot({ text: '@Ria help', savedMessage: saved, prisma });
    expect(prisma.groupRiaInvocation.create).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it('rejects ciphertext', async () => {
    const prisma = db({ message: { ...persisted, contentCiphertext: { ciphertext: 'opaque' } } });
    await maybeInvokeForiaBot({ text: '@Ria help', savedMessage: saved, prisma });
    expect(generate).not.toHaveBeenCalled();
  });
  it('claims once, persists and sends user-shaped canonical upserts', async () => {
    const prisma = db();
    await maybeInvokeForiaBot({ text: '@Ria help', savedMessage: saved, prisma });
    expect(prisma.groupRiaInvocation.create).toHaveBeenCalledWith({ data: { sourceMessageId: 25 } });
    expect(generate).toHaveBeenCalledWith('help');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      senderId: 999, chatRoomId: 42, clientMessageId: 'group-ria:25', isAutoReply: true,
    }));
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith(10, 42, expect.objectContaining({ id: 99, viewerId: 10 }));
  });
  it('does not regenerate or deliver when the source is already claimed', async () => {
    const prisma = db({ duplicate: true });
    await maybeInvokeForiaBot({ text: '@Ria help', savedMessage: saved, prisma });
    expect(generate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('does not deliver when consent is revoked between eligibility and delivery', async () => {
    const prisma = db();
    let calls = 0;
    prisma.chatRoom.findUnique.mockImplementation(async () => {
      calls += 1;
      return room(calls >= 4 ? members(false) : members());
    });
    await maybeInvokeForiaBot({ text: '@Ria help', savedMessage: saved, prisma });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
