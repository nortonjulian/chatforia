import { enqueueAI } from './aiQueue.js';
import { allow } from '../utils/tokenBucket.js';
import { generateAIResponse } from '../utils/generateAIResponse.js';
import { createMessageService } from './messageService.js';
import { extractGroupRiaPrompt, hasEncryptedMessageIndicators } from './groupRiaPolicy.js';

// Read env once per module load – tests set env before importing this file
const BOT_ID = Number(process.env.FORIA_BOT_USER_ID || 0);

const MAX_CHARS = Number(process.env.AI_MAX_INPUT_CHARS || 1500);

/**
 * maybeInvokeForiaBot({ text, savedMessage, io, prisma })
 * Privacy & Safety gates:
 * - Requires OPENAI_API_KEY to be set
 * - Room must have allowForiaBot = true
 * - aiAssistantMode respected: 'off' | 'mention' | 'always'
 * - Feature flag GROUP_RIA_ENABLED must explicitly be true (default disabled)
 * - MENTION only: explicit @Ria, /ask or legacy @ForiaBot
 * - Sender and another member must have demonstrably consented
 * - Only an unencrypted persisted group message can be sent to AI
 * - No other room messages or plaintext conversation history are read
 * - Per-room and per-sender throttles, bounded queue
 */
export async function maybeInvokeForiaBot({ text, savedMessage, io, prisma }) {
  // Explicit opt-in to this backend feature; there is no live message-send hook yet.
  if (process.env.GROUP_RIA_ENABLED !== 'true') return;

  // 1) Bot must be configured and the supplied text must be an intentional prompt.
  if (!BOT_ID || !extractGroupRiaPrompt(text)) return;

  // 2) Global kill-switch — don’t leak messages if no API key configured.
  //    We check both:
  //      - that the env var exists as an own property (tests can `delete` it)
  //      - that it’s non-empty.
  const hasOwnKey = Object.prototype.hasOwnProperty.call(
    process.env,
    'OPENAI_API_KEY'
  );
  const openaiKey = hasOwnKey ? process.env.OPENAI_API_KEY : '';
  if (!hasOwnKey || !openaiKey) return;

  const roomId = Number(savedMessage?.chatRoomId);
  const senderId = Number(savedMessage?.sender?.id || savedMessage?.senderId || 0);
  const messageId = Number(savedMessage?.id);
  if (![roomId, senderId, messageId].every((n) => Number.isSafeInteger(n) && n > 0)) return;

  // 3) Don’t reply to the bot itself
  if (senderId === BOT_ID) return;

  // 4) Per-room and per-sender rate limits (silent drop on overflow)
  if (!allow(`bot:room:${roomId}`, 6, 10_000)) return; // ~6 calls / 10s per room
  if (!allow(`bot:sender:${senderId}`, 8, 10_000)) return; // ~8 triggers / 10s per sender

  // 5) Fetch room + participants (need allow flags & mode)
  const room = await prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: {
      allowForiaBot: true,
      isGroup: true,
      aiAssistantMode: true,
      participants: {
        select: {
          userId: true,
          allowAIBot: true, // legacy room preference
          riaGroupConsentedAt: true, // explicit affirmative opt-in evidence
          user: { select: { username: true, strictE2EE: true } },
        },
      },
    },
  });
  if (!room?.isGroup || !room.allowForiaBot) return;
  // Do not honor historical ALWAYS mode. Group Ria is explicit invocation only.
  if (String(room.aiAssistantMode || 'OFF').toUpperCase() !== 'MENTION') return;

  const participants = room.participants || [];
  // Any Strict E2EE participant is a reason to refuse server-side group AI.
  // An omitted strictE2EE field is not evidence that access is permitted.
  if (participants.some((p) => p.user?.strictE2EE !== false)) return;

  // Must be a current member
  const senderMembership = participants.find((p) => p.userId === senderId);
  if (!senderMembership || senderMembership.allowAIBot !== true || !senderMembership.riaGroupConsentedAt) return;

  // For privacy: require at least one *other* participant to opt in
  const someoneElseOptedIn = participants.some(
    (p) => p.userId !== senderId && p.allowAIBot === true && !!p.riaGroupConsentedAt
  );
  if (!someoneElseOptedIn) return;

  // Independently load the canonical saved message; never trust plaintext passed
  // by a client or a partially shaped message from the create pipeline.
  const persisted = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
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
    },
  });
  if (!persisted ||
      persisted.chatRoomId !== roomId ||
      persisted.senderId !== senderId ||
      persisted.isAutoReply ||
      persisted.deletedForAll ||
      persisted.sender?.strictE2EE !== false ||
      hasEncryptedMessageIndicators(persisted)) {
    return;
  }

  const prompt = extractGroupRiaPrompt(persisted.rawContent);
  if (!prompt) return;

  // Do NOT fetch group history: even consented members have not necessarily
  // authorized historical context sharing. Only the invoking plaintext is used.

  // Queue the AI call under a per-room key to avoid bursts
  const roomKey = `room:${roomId}`;
  enqueueAI({
    roomKey,
    dropIfBusy: true, // shed load under burst without piling up
    fn: async () => {
      // Re-check room permissions/consent immediately before external AI use,
      // since a member may opt out while the request is queued.
      const current = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: {
          isGroup: true,
          allowForiaBot: true,
          aiAssistantMode: true,
          participants: {
            select: {
              userId: true, allowAIBot: true, riaGroupConsentedAt: true,
              user: { select: { strictE2EE: true } },
            },
          },
        },
      });
      const members = current?.participants || [];
      const initiator = members.find((p) => p.userId === senderId);
      if (!current?.isGroup || !current.allowForiaBot ||
          String(current.aiAssistantMode || '').toUpperCase() !== 'MENTION' ||
          members.some((p) => p.user?.strictE2EE !== false) ||
          !initiator?.allowAIBot || !initiator.riaGroupConsentedAt ||
          !members.some((p) => p.userId !== senderId && p.allowAIBot === true && p.riaGroupConsentedAt)) {
        return;
      }

      const reply = await generateAIResponse(prompt.slice(0, MAX_CHARS));
      if (!reply) return;

      // Persist via the normal pipeline (encryption/keys etc.)
      const botMsg = await createMessageService({
        senderId: BOT_ID,
        chatRoomId: roomId,
        content: reply,
        isAutoReply: true, // prevents auto-responder loops
      });

      io.to(String(roomId)).emit('receive_message', botMsg);
    },
  }).catch(() => {
    // don’t surface queue errors; just skip if scheduling fails
  });
}
