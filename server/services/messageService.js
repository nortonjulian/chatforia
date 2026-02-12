import prisma from '../utils/prismaClient.js';
import { isExplicit, cleanText } from '../utils/filter.js';
import { translateForTargets } from '../utils/translate.js';
import { translateText } from '../utils/translateText.js';
import { allow } from '../utils/tokenBucket.js';

const FORIA_BOT_USER_ID = Number(process.env.FORIA_BOT_USER_ID ?? 0);
const MAX_TRANSLATE_CHARS = Number(process.env.TRANSLATE_MAX_INPUT_CHARS || 1200);

/* =========================
 *  Plan-aware expiry limits
 * ========================= */
const FREE_MAX = 24 * 3600; // 24h
const PREMIUM_MAX = 7 * 24 * 3600; // 7d

function clampExpireSeconds(seconds, plan = 'FREE') {
  const max = (plan || 'FREE').toUpperCase() === 'PREMIUM' ? PREMIUM_MAX : FREE_MAX;
  if (!seconds || seconds <= 0) return 0;
  return Math.min(seconds, max);
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/* =========================
 *  Message pipeline (IN-APP)
 * ========================= */

export async function createMessageService({
  senderId,
  chatRoomId,
  content,
  contentCiphertext,
  expireSeconds,
  imageUrl = null,
  audioUrl = null,
  audioDurationSec = null,
  isAutoReply = false,
  attachments = [],
}) {
  const roomIdNum = Number(chatRoomId);

  // 0) Validate presence (allow content OR any media/attachments)
  if (
    !senderId ||
    !roomIdNum ||
    (!content && !contentCiphertext && !imageUrl && !audioUrl && !attachments?.length)
  ) {
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
      autoDeleteSeconds: true,
      publicKey: true,
      plan: true,
    },
  });
  if (!sender) throw new Error('Sender not found');

  const membership = await prisma.participant.findFirst({
    where: { chatRoomId: roomIdNum, userId: Number(senderId) },
  });
  if (!membership) throw new Error('Not a participant in this chat');

  // 2) Load participants (users) for filtering/translation/encryption context
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

  const recipientUsers = participants.map((p) => p.user).filter(Boolean);
  const recipientsExceptSender = recipientUsers.filter((u) => u.id !== sender.id);

  // 3) Profanity filtering
  const isMsgExplicit = content ? isExplicit(content) : false;
  const anyRecipientDisallows = recipientsExceptSender.some((u) => !u.allowExplicitContent);
  const senderDisallows = !sender.allowExplicitContent;
  const mustClean = Boolean(content) && (anyRecipientDisallows || senderDisallows);
  const cleanContent = mustClean ? cleanText(content) : content;

  // 4) Translations map
  let translationsMap = null;
  let translatedFrom = sender.preferredLanguage || 'en';
  if (cleanContent) {
    const targetLangs = recipientsExceptSender.map((u) => u.preferredLanguage || 'en');
    const res = await translateForTargets(cleanContent, translatedFrom, targetLangs);
    translationsMap = Object.keys(res.map || {}).length ? res.map : null;
    translatedFrom = res.from || translatedFrom;
  }

  // 5) Expiry clamp
  const requestedSecs = Number.isFinite(expireSeconds)
    ? Number(expireSeconds)
    : sender.autoDeleteSeconds || 0;

  const plan = (sender.plan || 'FREE').toUpperCase();
  const secsClamped = clampExpireSeconds(requestedSecs, plan);
  const expiresAt = secsClamped > 0 ? new Date(Date.now() + secsClamped * 1000) : null;

  // 6) Normalize ciphertext to string
  // 6) Normalize ciphertext to Json-compatible value
  const cipherValue =
    typeof contentCiphertext === 'string'
      ? safeJsonParse(contentCiphertext) ?? contentCiphertext // JSON string -> object, otherwise keep as string
      : contentCiphertext ?? null;


  // 7) Persist message
  const saved = await prisma.message.create({
    data: {
      contentCiphertext: cipherValue,
      rawContent: content ? content : '',
      translations: translationsMap,
      translatedFrom,
      isExplicit: isMsgExplicit,
      imageUrl: imageUrl || null,
      audioUrl: audioUrl || null,
      audioDurationSec: audioDurationSec ?? null,
      isAutoReply,
      expiresAt,
      sender: { connect: { id: sender.id } },
      chatRoom: { connect: { id: roomIdNum } },
      attachments: attachments?.length
        ? {
            createMany: {
              data: attachments.map((a) => ({
                kind: a.kind,
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

  // 8) Persist MessageKey rows (if present in ciphertext payload)
  try {
    const cipherObj =
      cipherValue && typeof cipherValue === 'object' ? cipherValue : safeJsonParse(String(cipherValue));

    const keyIds = Array.isArray(cipherObj?.keyIds) ? cipherObj.keyIds : [];

    if (keyIds.length) {
      await prisma.messageKey.createMany({
        data: keyIds
          .filter((k) => k?.userId && k?.wrappedKey)
          .map((k) => ({
            messageId: saved.id,
            userId: Number(k.userId),
            encryptedKey: String(k.wrappedKey),
          })),
        skipDuplicates: true,
      });
    }
  } catch (e) {
    console.warn('[E2EE] could not persist MessageKey rows', e?.message || e);
  }

  // 8.5) Bot webhook events (non-blocking)
  try {
    const { enqueueBotEventsForMessage } = await import('./botPlatform.js');
    enqueueBotEventsForMessage(saved).catch(() => {});
  } catch {
    // ignore
  }

  // ✅ IMPORTANT: NO SMS fan-out here.
  // In-app chat stays in-app.
  // External SMS sending belongs in smsService (SmsThread flow) using the user's active DID as `from`.

  return { ...saved, chatRoomId: roomIdNum };
}

/**
 * Auto-translate helper (unchanged)
 */
export async function maybeAutoTranslate({ savedMessage, io, prisma: prismaArg }) {
  try {
    const db = prismaArg || prisma;

    const hasProvider = !!process.env.DEEPL_API_KEY || !!process.env.TRANSLATE_ENDPOINT;
    if (!hasProvider) return;

    const roomId = Number(savedMessage.chatRoomId);
    const senderId = Number(savedMessage.senderId ?? savedMessage.sender?.id);
    const raw = String(savedMessage.rawContent || savedMessage.content || '').trim();
    if (!roomId || !raw) return;

    if (senderId && senderId === FORIA_BOT_USER_ID) return;

    if (!allow(`translate:${roomId}`, 12, 10_000)) return;

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

    const clipped = raw.slice(0, MAX_TRANSLATE_CHARS);

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

    const results = {};
    for (const lang of targets) {
      try {
        if (!allow(`translate:${roomId}:${lang}`, 6, 10_000)) continue;
        const out = await translateText({ text: clipped, targetLang: lang });
        if (out?.text) results[lang] = out.text;
      } catch {
        // skip
      }
    }

    if (Object.keys(results).length === 0) return;

    await db.message.update({
      where: { id: savedMessage.id },
      data: { translations: results },
      select: { id: true },
    });
  } catch (err) {
    console.error('maybeAutoTranslate failed:', err?.message || err);
  }
}
