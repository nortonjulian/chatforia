import { enqueueAI } from './aiQueue.js';
import { allow } from '../utils/tokenBucket.js';
import { generateGroupRiaReply } from './groupRiaProvider.js';
import { createMessageService, shapeMessageForUser } from './messageService.js';
import { emitMessageUpsertToUser } from './socketBus.js';
import { extractGroupRiaPrompt, hasEncryptedMessageIndicators } from './groupRiaPolicy.js';

const BOT_ID = Number(process.env.FORIA_BOT_USER_ID || 0);
const MAX_CHARS = Math.min(1500, Math.max(1, Number(process.env.AI_MAX_INPUT_CHARS) || 1500));

const ROOM_SELECT = {
  isGroup: true,
  allowForiaBot: true,
  aiAssistantMode: true,
  participants: {
    select: {
      userId: true,
      allowAIBot: true,
      riaGroupConsentedAt: true,
      user: { select: { strictE2EE: true } },
    },
  },
};
const MESSAGE_SELECT = {
  chatRoomId: true,
  senderId: true,
  rawContent: true,
  contentCiphertext: true,
  isAutoReply: true,
  deletedForAll: true,
  sender: { select: { strictE2EE: true } },
  keys: { select: { messageId: true }, take: 1 },
  payloads: { select: { messageId: true }, take: 1 },
  sessionKeys: { select: { messageId: true }, take: 1 },
};

function enabled() {
  return process.env.GROUP_RIA_ENABLED === 'true';
}

function roomPermitsRia(room, senderId) {
  if (!room?.isGroup || room.allowForiaBot !== true ||
      String(room.aiAssistantMode || '').toUpperCase() !== 'MENTION') return false;

  const members = room.participants || [];
  // Never use server-side AI in a room with a Strict E2EE participant.
  if (!members.length || members.some((p) => p.user?.strictE2EE !== false)) return false;
  // Ria needs a real room membership to post via createMessageService.
  if (!members.some((p) => p.userId === BOT_ID)) return false;

  const sender = members.find((p) => p.userId === senderId);
  if (sender?.allowAIBot !== true || !sender.riaGroupConsentedAt) return false;

  // The bot is NOT a second consenting human participant.
  return members.some((p) =>
    p.userId !== senderId && p.userId !== BOT_ID &&
    p.allowAIBot === true && !!p.riaGroupConsentedAt
  );
}

function permittedSource(message, roomId, senderId) {
  return !!message &&
    message.chatRoomId === roomId &&
    message.senderId === senderId &&
    message.isAutoReply !== true &&
    message.deletedForAll !== true &&
    message.sender?.strictE2EE === false &&
    !hasEncryptedMessageIndicators(message) &&
    !!extractGroupRiaPrompt(message.rawContent);
}

async function currentPermissionAndSource(prisma, roomId, senderId, messageId) {
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: ROOM_SELECT });
  if (!roomPermitsRia(room, senderId)) return null;

  const message = await prisma.message.findUnique({
    where: { id: messageId }, select: MESSAGE_SELECT,
  });
  if (!permittedSource(message, roomId, senderId)) return null;

  return { room, message };
}

/**
 * Group Ria is OFF by default, explicit-invocation-only, and does not use
 * conversation history. Never trust passed client text as AI content.
 *
 * Claims are permanent and unique per source message: a retry must not cause
 * a second billable API call, including after a process restart. A failed or
 * canceled invocation is deliberately not automatically retried.
 */
export async function maybeInvokeForiaBot({ text, savedMessage, prisma }) {
  if (!enabled() || !BOT_ID || !extractGroupRiaPrompt(text) ||
      !String(process.env.OPENAI_API_KEY || '').trim()) return;

  const roomId = Number(savedMessage?.chatRoomId);
  const senderId = Number(savedMessage?.senderId ?? savedMessage?.sender?.id);
  const messageId = Number(savedMessage?.id);
  if (![roomId, senderId, messageId].every((n) => Number.isSafeInteger(n) && n > 0) ||
      senderId === BOT_ID || savedMessage?.isAutoReply === true) return;

  if (!allow(`bot:room:${roomId}`, 6, 10_000) ||
      !allow(`bot:sender:${senderId}`, 8, 10_000)) return;

  // First DB check happens only after a deliberate mention, with the flag ON.
  if (!await currentPermissionAndSource(prisma, roomId, senderId, messageId)) return;

  return enqueueAI({
    roomKey: `group-ria:${roomId}`,
    dropIfBusy: true,
    fn: async () => {
      // Revocation, deletion, membership and E2EE may change while queued.
      if (!enabled()) return;
      const ready = await currentPermissionAndSource(prisma, roomId, senderId, messageId);
      if (!ready) return;

      try {
        // Unique DB constraint makes this atomic across retries and workers.
        await prisma.groupRiaInvocation.create({
          data: { sourceMessageId: messageId },
        });
      } catch (err) {
        if (err?.code === 'P2002') return; // same message was already claimed
        throw err; // fail closed if durable idempotency is unavailable
      }

      // Do not contact OpenAI if the user has revoked consent since the claim.
      if (!enabled()) return;
      const preAI = await currentPermissionAndSource(prisma, roomId, senderId, messageId);
      if (!preAI) return;

      const prompt = extractGroupRiaPrompt(preAI.message.rawContent)?.slice(0, MAX_CHARS);
      if (!prompt) return;

      const reply = await generateGroupRiaReply(prompt);
      if (!reply || !enabled()) return;

      // In particular, don't post a response after a consent revocation.
      const beforeDelivery = await currentPermissionAndSource(prisma, roomId, senderId, messageId);
      if (!beforeDelivery || beforeDelivery.message.rawContent !== preAI.message.rawContent) return;

      // Bot must be a room participant; never silently add anyone.
      const botMessage = await createMessageService({
        senderId: BOT_ID,
        chatRoomId: roomId,
        clientMessageId: `group-ria:${messageId}`,
        content: reply,
        isAutoReply: true,
      });

      await prisma.groupRiaInvocation.update({
        where: { sourceMessageId: messageId },
        data: { status: 'DELIVERED', replyMessageId: botMessage.id },
      });

      // Use the same per-participant shaped message:upsert path as POST /messages.
      // Raw room emissions could leak user-specific translations/encryption data.
      const participants = await prisma.participant.findMany({
        where: { chatRoomId: roomId },
        select: { userId: true },
      });
      await Promise.all(participants.map(async ({ userId }) => {
        const shaped = await shapeMessageForUser(botMessage.id, userId);
        if (shaped) await emitMessageUpsertToUser(userId, roomId, shaped);
      }));
    },
  }).catch((err) => {
    // Never log the prompt, message content or reply.
    console.warn('[group-ria] invocation skipped:', err?.code || err?.name || 'error');
  });
}
