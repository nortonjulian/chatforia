import { enqueueAI } from './aiQueue.js';
import { allow } from '../utils/tokenBucket.js';
import { generateAIResponse } from '../utils/generateAIResponse.js';
import { createMessageService } from './messageService.js';

// Read env once per module load – tests set env before importing this file
const BOT_ID = Number(process.env.FORIA_BOT_USER_ID || 0);

const MAX_CHARS = Number(process.env.AI_MAX_INPUT_CHARS || 1500);

/**
 * maybeInvokeForiaBot({ text, savedMessage, io, prisma })
 * Privacy & Safety gates:
 * - Requires OPENAI_API_KEY to be set
 * - Room must have allowForiaBot = true
 * - aiAssistantMode respected: 'off' | 'mention' | 'always'
 * - At least one *other* participant must have allowAIBot = true
 * - Per-room and per-sender throttles
 * - Context includes only lines from opted-in users (plus the sender)
 * - Queued execution to bound concurrency/latency
 */
export async function maybeInvokeForiaBot({ text, savedMessage, io, prisma }) {
  // 1) Bot must be configured
  if (!BOT_ID) return;

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

  const roomId = Number(savedMessage.chatRoomId);
  const senderId = Number(
    savedMessage.sender?.id || savedMessage.senderId || 0
  );
  if (!roomId || !senderId) return;

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
      aiAssistantMode: true, // 'off' | 'mention' | 'always'
      participants: {
        select: {
          userId: true,
          allowAIBot: true, // per-user room opt-in
          user: { select: { username: true } },
        },
      },
    },
  });
  if (!room) return;
  if (!room.allowForiaBot) return; // hard gate
  if (room.aiAssistantMode === 'off') return; // disabled

  const participants = room.participants || [];

  // Must be a current member
  const senderMembership = participants.find((p) => p.userId === senderId);
  if (!senderMembership) return;

  // For privacy: require at least one *other* participant to opt in
  const someoneElseOptedIn = participants.some(
    (p) => p.userId !== senderId && p.allowAIBot === true
  );
  if (!someoneElseOptedIn) return;

  // Mode enforcement: mention-only requires explicit mention/command
  const body = String(text || '');
  const mentioned =
    /(^|\s)@foriabot\b/i.test(body) ||
    /^\/ask(\s|$)/i.test(body) ||
    /^\/foria(\s|$)/i.test(body);
  if (room.aiAssistantMode === 'mention' && !mentioned) return;

  // Build compact context using only lines from opted-in users (+ the sender)
  const allowedUserIds = new Set(
    participants.filter((p) => p.allowAIBot === true).map((p) => p.userId)
  );
  allowedUserIds.add(senderId); // always include the sender’s own text

  const last = await prisma.message.findMany({
    where: { chatRoomId: roomId },
    orderBy: { id: 'desc' },
    take: 12,
    select: {
      rawContent: true,
      sender: { select: { id: true, username: true } },
    },
  });

  const context = last
    .reverse()
    .filter((m) => m.sender?.id && allowedUserIds.has(m.sender.id))
    .map((m) => `${m.sender.username}: ${m.rawContent || ''}`)
    .join('\n')
    .slice(-2000); // keep small to reduce exposure/cost

  // Strip command/mention noise from the user prompt and clip size
  const userPrompt = body
    .replace(/(^|\s)@foriabot\b/i, ' ')
    .replace(/^\/ask\s*/i, '')
    .replace(/^\/foria\s*/i, '')
    .trim()
    .slice(0, MAX_CHARS);

  const system =
    'You are ForiaBot, a concise, friendly assistant in a group chat. Be helpful, avoid personal data, and do not provide medical, legal, or financial advice.';

  // Queue the AI call under a per-room key to avoid bursts
  const roomKey = `room:${roomId}`;
  enqueueAI({
    roomKey,
    dropIfBusy: true, // shed load under burst without piling up
    fn: async () => {
      const reply = await generateAIResponse(
        userPrompt || body.slice(0, MAX_CHARS),
        {
          system,
          context,
          maxTokens: 220,
          temperature: 0.4,
        }
      );
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
