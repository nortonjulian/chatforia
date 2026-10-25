import { extractGroupRiaPrompt } from './groupRiaPolicy.js';

// This guard is deliberately independent of HTTP and the AI provider.
// It must run BEFORE an explicit plaintext invocation is persisted.
export class GroupRiaInvocationError extends Error {
  constructor(code, status = 403) {
    super(code);
    this.name = 'GroupRiaInvocationError';
    this.code = code;
    this.status = status;
  }
}

function deny(code, status) {
  throw new GroupRiaInvocationError(code, status);
}

const ALLOWED_BODY_FIELDS = new Set([
  'chatRoomId',
  'clientMessageId',
  'content',
  'riaInvocation',
]);

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

/**
 * Validate the versioned, affirmative plaintext Group Ria request.
 * An ordinary encrypted or plaintext message must never reach this guard
 * by accident. Callers MUST keep the normal message route unchanged.
 *
 * Only check the current room state; never fetch conversation history.
 * The provider/delivery pipeline must revalidate consent before acting.
 */
export async function authorizeGroupRiaInvocation({
  prisma,
  body,
  senderId,
  enabled = process.env.GROUP_RIA_ENABLED === 'true',
  botId = Number(process.env.FORIA_BOT_USER_ID || 0),
  providerReady = Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
}) {
  // No feature-availability information or database access while disabled.
  if (enabled !== true) deny('GROUP_RIA_DISABLED', 404);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    deny('INVALID_RIA_REQUEST', 400);
  }

  if (Object.keys(body).some((key) => !ALLOWED_BODY_FIELDS.has(key))) {
    // Includes encryptedPayloads, keys, attachments, TTL, text aliases, etc.
    deny('INVALID_RIA_REQUEST_FIELDS', 400);
  }

  const intent = body.riaInvocation;
  if (!intent || typeof intent !== 'object' || Array.isArray(intent) ||
      Object.keys(intent).length !== 2 ||
      intent.version !== 1 || intent.acknowledgePlaintext !== true) {
    deny('EXPLICIT_RIA_ACKNOWLEDGMENT_REQUIRED', 400);
  }

  const roomId = body.chatRoomId;
  const userId = Number(senderId);
  const id = body.clientMessageId;
  const content = body.content;

  if (!Number.isSafeInteger(roomId) || roomId <= 0 ||
      !Number.isSafeInteger(userId) || userId <= 0 ||
      !Number.isSafeInteger(botId) || botId <= 0 ||
      userId === botId) {
    deny('INVALID_RIA_IDENTIFIERS', 400);
  }

  // Dedicated namespace prevents a normal message from being upgraded to an
  // AI request by retrying the same client id through a different endpoint.
  if (typeof id !== 'string' ||
      !/^ria-v1:[A-Za-z0-9_-]{12,100}$/.test(id)) {
    deny('INVALID_RIA_CLIENT_MESSAGE_ID', 400);
  }

  if (typeof content !== 'string' ||
      content.trim() !== content ||
      content.length > 1500 ||
      !extractGroupRiaPrompt(content)) {
    deny('INVALID_RIA_PROMPT', 400);
  }

  if (!providerReady) deny('GROUP_RIA_UNAVAILABLE', 503);

  const room = await prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: ROOM_SELECT,
  });

  if (!room?.isGroup || room.allowForiaBot !== true ||
      room.aiAssistantMode !== 'MENTION') {
    deny('GROUP_RIA_NOT_ALLOWED');
  }

  const members = room.participants || [];
  if (!members.length ||
      members.some((p) => p.user?.strictE2EE !== false)) {
    deny('GROUP_RIA_STRICT_E2EE_OR_UNAVAILABLE');
  }

  if (!members.some((p) => p.userId === botId)) {
    deny('GROUP_RIA_BOT_NOT_IN_ROOM');
  }

  const sender = members.find((p) => p.userId === userId);
  if (!sender || sender.allowAIBot !== true ||
      !sender.riaGroupConsentedAt) {
    deny('GROUP_RIA_SENDER_NOT_CONSENTED');
  }

  const anotherConsentingHuman = members.some((p) =>
    p.userId !== userId && p.userId !== botId &&
    p.allowAIBot === true && Boolean(p.riaGroupConsentedAt)
  );
  if (!anotherConsentingHuman) deny('GROUP_RIA_SECOND_CONSENT_MISSING');

  return { roomId, senderId: userId, botId, content, clientMessageId: id };
}
