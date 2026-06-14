import prisma from '../utils/prismaClient.js';
import { isExplicit, cleanText } from '../utils/filter.js';
// import { translateForTargets } from '../utils/translate.js';
// import { translateText } from '../utils/translateText.js';
import { maybeTranslateForTarget } from './translation/translateMessage.js';
import { allow } from '../utils/tokenBucket.js';
import * as socketBus from './socketBus.js';

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
  clientMessageId = null,
  encryptedKeys = null,
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

  // ✅ Idempotency: normalize client message id once and use it both for lookup and create
  const cid = typeof clientMessageId === 'string' ? clientMessageId.trim() : '';
  if (cid) {
    const existing = await prisma.message.findFirst({
      where: {
        chatRoomId: roomIdNum,
        senderId: sender.id,
        clientMessageId: cid,
      },
      select: {
        id: true,
        clientMessageId: true,
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
            thumbUrl: true,
            createdAt: true,
          },
        },
        revision: true,
      },
    });

    if (existing) return { ...existing, chatRoomId: roomIdNum };
  }

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
  
  // 🔥 Strip placeholder text if media exists
  const placeholderTexts = new Set([
    '[image]',
    '[video]',
    '[audio]',
    '[file]',
    '[attachment]',
  ]);

  const normalizedContent = typeof content === 'string' ? content.trim().toLowerCase() : '';
  const isPlaceholder = placeholderTexts.has(normalizedContent);

  if (attachments?.length && isPlaceholder) {
    content = '';
  }

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
      const targetLangs = [
    ...new Set(
      recipientsExceptSender
        .map((u) => String(u.preferredLanguage || 'en').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const map = {};

  for (const lang of targetLangs) {
    const result = await maybeTranslateForTarget(
      cleanContent,
      translatedFrom,
      lang
    );

    if (result?.translatedText) {
      map[lang] = result.translatedText;
    }

    if (result?.detectedLang) {
      translatedFrom = result.detectedLang;
    }
  }

translationsMap = Object.keys(map).length ? map : null;
  }

  // 5) Expiry clamp
  const requestedSecs = Number.isFinite(expireSeconds)
    ? Number(expireSeconds)
    : sender.autoDeleteSeconds || 0;

  const plan = (sender.plan || 'FREE').toUpperCase();
  const secsClamped = clampExpireSeconds(requestedSecs, plan);
  const expiresAt = secsClamped > 0 ? new Date(Date.now() + secsClamped * 1000) : null;

  // 6) Normalize ciphertext to Json-compatible value
  const cipherValue =
    typeof contentCiphertext === 'string'
      ? safeJsonParse(contentCiphertext) ?? contentCiphertext
      : contentCiphertext ?? null;

  // If encryptedKeys arrived as a JSON string, parse it here (non-blocking)
  let encryptedKeysObj = encryptedKeys;
  if (typeof encryptedKeys === 'string') {
    const parsed = safeJsonParse(encryptedKeys);
    encryptedKeysObj = parsed && typeof parsed === 'object' ? parsed : null;
  }

  // 7) Persist message & message keys in a single transaction for atomicity
  let saved;
  try {
    // Build message create payload (re-use your existing shape)
    const messageCreateData = {
      contentCiphertext: cipherValue,
      rawContent: content ? content : '',
      translations: translationsMap,
      translatedFrom,
      clientMessageId: cid || null,
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
    };

    // If we have message keys, build rows for createMany
    const keyRows =
      encryptedKeysObj && typeof encryptedKeysObj === 'object' && !Array.isArray(encryptedKeysObj)
        ? Object.entries(encryptedKeysObj)
            .map(([userIdRaw, encryptedKey]) => {
              const uid = Number(userIdRaw);
              const keyStr = encryptedKey == null ? '' : String(encryptedKey);
              return { userId: uid, encryptedKey: keyStr };
            })
            .filter((r) => Number.isFinite(r.userId) && r.encryptedKey)
        : [];

    // Run a transaction: create message, then (if keys) create messageKey rows referencing saved.id
    saved = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: messageCreateData,
        select: {
          id: true,
          contentCiphertext: true,
          translations: true,
          translatedFrom: true,
          clientMessageId: true,
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
              thumbUrl: true,
              createdAt: true,
            },
          },
          revision: true,
        },
      });

      if (keyRows.length) {
        // attach messageId to each
        const rowsWithMessageId = keyRows.map((r) => ({ ...r, messageId: created.id }));
        await tx.messageKey.createMany({
          data: rowsWithMessageId,
          skipDuplicates: true,
        });
      }

      return created;
    });
  } catch (e) {
    console.error('[createMessageService] persist failed', e?.message || e);
    throw e;
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

  await maybeAutoTranslate({
    savedMessage: saved,
    prisma,
  });

  return { ...saved, chatRoomId: roomIdNum };
}

/**
 * Auto-translate helper (unchanged)
 */
export async function maybeAutoTranslate({ savedMessage, io, prisma: prismaArg }) {
  try {
    const db = prismaArg || prisma;

    const hasProvider =
      !!process.env.GOOGLE_TRANSLATE_API_KEY ||
      !!process.env.GOOGLE_API_KEY ||
      !!process.env.GOOGLE_PROJECT_ID ||
      !!process.env.DEEPL_API_KEY ||
      !!process.env.TRANSLATE_ENDPOINT;

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

    const mode = String(room.autoTranslateMode || 'OFF').toUpperCase();
    if (mode === 'OFF') return;

    if (mode === 'TAGGED') {
      const tagged = /(^|\s)#translate(\s|$)|^\/tr(\s|$)/i.test(raw);
      if (!tagged) return;
    }

    const clipped = raw.slice(0, MAX_TRANSLATE_CHARS);

    const participants = await db.participant.findMany({
      where: { chatRoomId: roomId },
      include: {
        user: {
          select: {
            id: true,
            preferredLanguage: true,
            autoTranslate: true
          }
        }
      },
    });

    const targets = new Set(
      (participants || [])
        .filter((p) => p.user?.autoTranslate === true)
        .map((p) => (p.user?.preferredLanguage || 'en').trim().toLowerCase())
        .filter(Boolean)
    );
    if (targets.size === 0) return;

    const results = {};

    for (const lang of targets) {
      try {
        if (!allow(`translate:${roomId}:${lang}`, 6, 10_000)) continue;

        const out = await translateText({
          text: clipped,
          targetLang: lang
        });

        const translated =
          out?.translatedText || out?.translated || out?.text || null;

        if (translated) {
          results[lang] = translated;
        }
      } catch (err) {
        console.error('[maybeAutoTranslate] translate failed:', lang, err?.message || err);
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

export async function fetchMessageById(id) {
  if (!id) return null;

  const m = await prisma.message.findUnique({
    where: { id: Number(id) },
    select: {
      id: true,
      chatRoomId: true,
      createdAt: true,
      expiresAt: true,
      editedAt: true,
      deletedForAll: true,
      deletedAt: true,
      deletedById: true,

      clientMessageId: true,
      rawContent: true,
      contentCiphertext: true,
      translations: true,
      translatedFrom: true,
      isExplicit: true,
      isAutoReply: true,

      imageUrl: true,
      audioUrl: true,
      audioDurationSec: true,

      sender: {
        select: {
          id: true,
          username: true,
          publicKey: true,
          avatarUrl: true,
        },
      },

      attachments: {
        select: {
          id: true,
          kind: true,
          url: true,           // relative — client requests signed URL when needed
          mimeType: true,
          width: true,
          height: true,
          durationSec: true,
          caption: true,
          thumbUrl: true,
          createdAt: true,
        },
      },

      keys: {
        select: {
          userId: true,
          encryptedKey: true,
        },
      },
    },
  });

  if (!m) return null;

  // Normalize small things (optional)
  const translations = m.translations && Object.keys(m.translations).length ? m.translations : null;

  return {
    ...m,
    translations,
    senderId: m.sender?.id ?? null,
  };
}

export async function shapeMessageForUser(messageId, viewerUserId) {
  if (!messageId || !viewerUserId) return null;

  const m = await prisma.message.findUnique({
    where: { id: Number(messageId) },
    select: {
      id: true,
      chatRoomId: true,
      createdAt: true,
      expiresAt: true,
      editedAt: true,
      deletedForAll: true,
      deletedAt: true,
      deletedById: true,

      clientMessageId: true,
      rawContent: true,
      contentCiphertext: true,
      translations: true,
      translatedFrom: true,
      isExplicit: true,
      isAutoReply: true,

      imageUrl: true,
      audioUrl: true,
      audioDurationSec: true,
      revision: true,

      sender: {
        select: {
          id: true,
          username: true,
          publicKey: true,
          avatarUrl: true,
          preferredLanguage: true,
        },
      },

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
          thumbUrl: true,
          createdAt: true,
        },
      },

      keys: {
        where: { userId: Number(viewerUserId) },
        select: {
          userId: true,
          encryptedKey: true,
        },
      },
    },
  });

  if (!m) return null;

  const viewer = await prisma.user.findUnique({
    where: { id: Number(viewerUserId) },
    select: {
      id: true,
      preferredLanguage: true,
    },
  });

  const viewerLang = (viewer?.preferredLanguage || 'en').trim().toLowerCase();
  const senderId = Number(m.sender?.id || 0);
  const isSender = senderId === Number(viewerUserId);
  const hasCipher = !!m.contentCiphertext;

  const translatedForMe =
    !isSender && m.translations && typeof m.translations === 'object'
      ? m.translations[viewerLang] || null
      : null;

  return {
    ...m,
    senderId,
    encryptedKeyForMe: m.keys?.[0]?.encryptedKey || null,
    translatedForMe,
    rawContent: hasCipher && !isSender ? null : (m.rawContent || ''),
  };
}

/**
 * Register helper so socketBus can emit canonical rows
 * even when only an id is provided.
 *
 * MUST run exactly once on server boot.
 */
socketBus.setHelpers({
  fetchMessageById,
});