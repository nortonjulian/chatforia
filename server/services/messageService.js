import { prisma } from '../utils/prismaClient.js';
import { isExplicit, cleanText } from '../utils/filter.js';
import { translateForTargets } from '../utils/translate.js';
import { encryptMessageForParticipants } from '../utils/encryption.js';
import { translateText } from '../utils/translateText.js';
import { allow } from '../utils/tokenBucket.js';

const ORBIT_BOT_USER_ID = Number(process.env.ORBIT_BOT_USER_ID ?? 0);
const MAX_TRANSLATE_CHARS = Number(process.env.TRANSLATE_MAX_INPUT_CHARS || 1200);

/**
 * Creates a message with full pipeline:
 *  - verifies membership (sender is in the room)
 *  - profanity filter based on sender/recipients
 *  - per-language translations (JSON map)
 *  - AES-GCM content encryption + NaCl-sealed session keys for all participants
 *  - optional expiry (per-message override beats user default)
 *
 * @param {Object} args
 * @param {number} args.senderId
 * @param {number|string} args.chatRoomId
 * @param {string} [args.content]                 // plaintext from client
 * @param {number} [args.expireSeconds]           // per-message TTL (seconds); overrides user default if provided
 * @param {string|null} [args.imageUrl=null]      // legacy single image url
 * @param {string|null} [args.audioUrl=null]      // legacy single audio url
 * @param {number|null} [args.audioDurationSec=null]
 * @param {boolean} [args.isAutoReply=false]      // mark message as auto-reply (for UI + loop guards)
 * @param {Array} [args.attachments=[]]           // [{ kind, url, mimeType, width, height, durationSec, caption }]
 * @returns {Promise<Object>} Prisma message (selected fields) + { chatRoomId }
 */
export async function createMessageService({
  senderId,
  chatRoomId,
  content,
  expireSeconds,
  imageUrl = null,
  audioUrl = null,
  audioDurationSec = null,
  isAutoReply = false,
  attachments = [],
}) {
  const roomIdNum = Number(chatRoomId);

  // 0) Validate presence (allow content OR any media/attachments)
  if (!senderId || !roomIdNum || (!content && !imageUrl && !audioUrl && !attachments?.length)) {
    throw new Error('Missing required fields');
  }

  // 1) Ensure sender exists and is a participant in this room
  const sender = await prisma.user.findUnique({
    where: { id: Number(senderId) },
    select: {
      id: true,
      username: true,
      preferredLanguage: true,
      allowExplicitContent: true,
      autoDeleteSeconds: true, // default TTL
      publicKey: true,
    },
  });
  if (!sender) throw new Error('Sender not found');

  const membership = await prisma.participant.findFirst({
    where: { chatRoomId: roomIdNum, userId: Number(senderId) },
  });
  if (!membership) throw new Error('Not a participant in this chat');

  // 2) Load participants (users) for filtering, translation, and encryption targets
  const participants = await prisma.participant.findMany({
    where: { chatRoomId: roomIdNum },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          preferredLanguage: true,
          allowExplicitContent: true,
          publicKey: true,
        },
      },
    },
  });

  const recipientUsers = participants.map((p) => p.user); // includes sender
  const recipientsExceptSender = recipientUsers.filter((u) => u.id !== sender.id);

  // 3) Profanity filtering (respect sender & recipients)
  const isMsgExplicit = content ? isExplicit(content) : false;
  const anyRecipientDisallows = recipientsExceptSender.some((u) => !u.allowExplicitContent);
  const senderDisallows = !sender.allowExplicitContent;
  const mustClean = Boolean(content) && (anyRecipientDisallows || senderDisallows);
  const cleanContent = mustClean ? cleanText(content) : content;

  // 4) Per-language translations (store a map)
  let translationsMap = null;
  let translatedFrom = sender.preferredLanguage || 'en';
  if (cleanContent) {
    const targetLangs = recipientsExceptSender.map((u) => u.preferredLanguage || 'en');
    const res = await translateForTargets(cleanContent, translatedFrom, targetLangs);
    translationsMap = Object.keys(res.map || {}).length ? res.map : null;
    translatedFrom = res.from || translatedFrom;
  }

  // 5) Expiry: per-message override beats user default
  const secs = Number.isFinite(expireSeconds)
    ? Number(expireSeconds)
    : sender.autoDeleteSeconds || 0;
  const expiresAt = secs > 0 ? new Date(Date.now() + secs * 1000) : null;

  // 6) Encrypt message for all participants (AES-GCM + NaCl sealed session key per user)
  const { ciphertext, encryptedKeys } = await encryptMessageForParticipants(
    cleanContent || '',
    sender,
    recipientUsers // includes sender
  );

  // 7) Persist the message (+ optional attachments)
  const saved = await prisma.message.create({
    data: {
      contentCiphertext: ciphertext,
      encryptedKeys, // legacy JSON (if you still keep it) + normalized table below
      rawContent: content || null, // visible to sender/admin by your GET route
      translations: translationsMap, // JSON map of lang -> translated text (plaintext)
      translatedFrom,
      isExplicit: isMsgExplicit,
      imageUrl: imageUrl || null, // legacy single image
      audioUrl: audioUrl || null, // legacy single audio
      audioDurationSec: audioDurationSec ?? null,
      isAutoReply,
      expiresAt,
      sender: { connect: { id: sender.id } },
      chatRoom: { connect: { id: roomIdNum } },
      attachments: attachments?.length
        ? {
            createMany: {
              data: attachments.map((a) => ({
                kind: a.kind, // 'image' | 'video' | 'audio' | 'file'
                url: a.url,
                mimeType: a.mimeType || '',
                width: a.width ?? null,
                height: a.height ?? null,
                durationSec: a.durationSec ?? null,
                caption: a.caption ?? null,
              })),
            },
          }
        : undefined,
    },
    select: {
      id: true,
      contentCiphertext: true,
      encryptedKeys: true,
      translations: true,
      translatedFrom: true,
      isExplicit: true,
      imageUrl: true,
      audioUrl: true,
      audioDurationSec: true,
      isAutoReply: true,
      expiresAt: true,
      createdAt: true,
      senderId: true,
      sender: { select: { id: true, username: true, publicKey: true, avatarUrl: true } },
      chatRoomId: true,
      rawContent: true,
      attachments: {
        select: {
          id: true,
          kind: true,
          url: true,
          mimeType: true,
          width: true,
          height: true,
          durationSec: true,
          caption: true,
          createdAt: true,
        },
      },
    },
  });

  // 7.5) Queue private webhook bot events (non-blocking)
  try {
    const { enqueueBotEventsForMessage } = await import('./botPlatform.js');
    enqueueBotEventsForMessage(saved).catch(() => {});
  } catch {
    // bot platform not present/disabled — ignore
  }

  // 8) (Optional) Normalize keys into MessageKey table
  try {
    const entries = Object.entries(saved.encryptedKeys || {}); // [ [userId, encKey], ... ]
    if (entries.length) {
      await prisma.$transaction(
        entries.map(([userIdStr, encKey]) =>
          prisma.messageKey.upsert({
            where: {
              messageId_userId: {
                messageId: saved.id,
                userId: Number(userIdStr),
              },
            },
            update: { encryptedKey: encKey },
            create: {
              messageId: saved.id,
              userId: Number(userIdStr),
              encryptedKey: encKey,
            },
          })
        )
      );
    }
  } catch {
    // Table might not exist yet. Safe to ignore.
  }

  // 9) Shape for socket consumers (ensure chatRoomId is present)
  return {
    ...saved,
    chatRoomId: roomIdNum,
  };
}

/**
 * Auto-translate helper (privacy-first).
 * Stores a translations map on the original message:
 *   message.translations = { "en": "...", "es": "...", ... }
 * Triggers only when a provider key/endpoint exists and based on room mode.
 */
export async function maybeAutoTranslate({ savedMessage, io, prisma: prismaArg }) {
  try {
    const db = prismaArg || prisma;

    // Provider available?
    const hasProvider = !!process.env.DEEPL_API_KEY || !!process.env.TRANSLATE_ENDPOINT; // e.g., a custom service
    if (!hasProvider) return;

    const roomId = Number(savedMessage.chatRoomId);
    const senderId = Number(savedMessage.senderId ?? savedMessage.sender?.id);
    const raw = String(savedMessage.rawContent || savedMessage.content || '').trim();
    if (!roomId || !raw) return;

    // Avoid loops for bot/system messages
    if (senderId && senderId === ORBIT_BOT_USER_ID) return;

    // Throttle per room to control cost
    if (!allow(`translate:${roomId}`, 12, 10_000)) return;

    // Mode checks
    const room = await db.chatRoom.findUnique({
      where: { id: roomId },
      select: { autoTranslateMode: true },
    });
    if (!room) return;

    const mode = room.autoTranslateMode || 'off';
    if (mode === 'off') return;

    if (mode === 'tagged') {
      const tagged = /(^|\s)#translate(\s|$)|^\/tr(\s|$)/i.test(raw);
      if (!tagged) return;
    }

    // Clip outbound text (privacy+cost)
    const clipped = raw.slice(0, MAX_TRANSLATE_CHARS);

    // Target languages = participants' preferredLanguage (unique)
    const participants = await db.participant.findMany({
      where: { chatRoomId: roomId },
      include: { user: { select: { id: true, preferredLanguage: true } } },
    });

    const targets = new Set(
      (participants || [])
        .map((p) => (p.user?.preferredLanguage || 'en').trim().toLowerCase())
        .filter(Boolean)
    );

    if (targets.size === 0) return;

    // Translate fan-out with per-language throttles
    const results = {};
    for (const lang of targets) {
      try {
        if (!allow(`translate:${roomId}:${lang}`, 6, 10_000)) continue;
        const out = await translateText({ text: clipped, targetLang: lang });
        if (out?.text) results[lang] = out.text;
      } catch {
        // skip failing languages; continue others
      }
    }

    if (Object.keys(results).length === 0) return;

    // Persist translations map onto the original message
    await db.message.update({
      where: { id: savedMessage.id },
      data: { translations: results },
      select: { id: true },
    });
  } catch (err) {
    console.error('maybeAutoTranslate failed:', err);
  }
}
