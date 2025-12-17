import { prisma } from '../utils/prismaClient.js';
import { isExplicit, cleanText } from '../utils/filter.js';
import { translateForTargets } from '../utils/translate.js';

const DEV_FALLBACKS = String(process.env.DEV_FALLBACKS || '').toLowerCase() === 'true';

/**
 * Normalize incoming audience into the Prisma enum value.
 * Accepts: PUBLIC | EVERYONE | FRIENDS | MUTUALS | CUSTOM | CONTACTS
 * Stores:  EVERYONE | MUTUALS | CUSTOM | CONTACTS
 * (PUBLIC maps to EVERYONE; FRIENDS maps to MUTUALS)
 */
function normalizeAudience(a) {
  const v = String(a || '').toUpperCase();
  if (v === 'PUBLIC' || v === 'EVERYONE') return 'EVERYONE';
  if (v === 'FRIENDS' || v === 'MUTUALS') return 'MUTUALS';
  if (v === 'CUSTOM') return 'CUSTOM';
  if (v === 'CONTACTS') return 'CONTACTS';
  throw new Error(`Unsupported audience: ${a}`);
}

/**
 * Resolve audience userIds.
 */
export async function getAudienceUserIds({
  authorId,
  mode = 'MUTUALS',
  customIds = [],
}) {
  const m = String(mode || '').toUpperCase();

  if (m === 'CUSTOM') {
    return [...new Set(customIds.map(Number))].filter(Boolean);
  }

  // All of my one-way contacts
  const mine = await prisma.contact.findMany({
    where: { ownerId: Number(authorId) },
    select: { userId: true },
  });
  const myContactIds = mine.map((c) => c.userId);
  if (!myContactIds.length) return [];

  if (m === 'MUTUALS' || m === 'FRIENDS') {
    const reciprocals = await prisma.contact.findMany({
      where: { ownerId: { in: myContactIds }, userId: Number(authorId) },
      select: { ownerId: true },
    });
    const mutualSet = new Set(reciprocals.map((r) => r.ownerId));
    return myContactIds.filter((id) => mutualSet.has(id));
  }

  if (m === 'CONTACTS') {
    return myContactIds;
  }

  // Default to MUTUALS semantics
  const reciprocals = await prisma.contact.findMany({
    where: { ownerId: { in: myContactIds }, userId: Number(authorId) },
    select: { ownerId: true },
  });
  const mutualSet = new Set(reciprocals.map((r) => r.ownerId));
  return myContactIds.filter((id) => mutualSet.has(id));
}

/**
 * Create a status and persist per-user envelope keys.
 */
export async function createStatusService({
  authorId,
  caption = '',
  files = [],
  audience = 'MUTUALS',
  customAudienceIds = [],
  expireSeconds = 24 * 3600,
}) {
  // Normalize to Prisma enum
  const audienceEnum = normalizeAudience(audience);
  const isEveryone = audienceEnum === 'EVERYONE';

  const author = await prisma.user.findUnique({
    where: { id: Number(authorId) },
    select: {
      id: true,
      username: true,
      preferredLanguage: true,
      allowExplicitContent: true,
      publicKey: true,
    },
  });
  if (!author) throw new Error('Author not found');

  // CUSTOM default to [self] if empty
  const customIdsNormalized =
    String(audience).toUpperCase() === 'CUSTOM' &&
    (!customAudienceIds || customAudienceIds.length === 0)
      ? [author.id]
      : customAudienceIds;

  const audienceIds = isEveryone
    ? []
    : await getAudienceUserIds({
        authorId: author.id,
        mode: audience, // original mode for resolver semantics
        customIds: customIdsNormalized,
      });

  if (!isEveryone && !audienceIds.length) {
    throw new Error('No audience');
  }

  // Users for crypto/translation
  const allUserIds = isEveryone ? [author.id] : [author.id, ...audienceIds];
  const users = await prisma.user.findMany({
    where: { id: { in: allUserIds } },
    select: {
      id: true,
      username: true,
      preferredLanguage: true,
      allowExplicitContent: true,
      publicKey: true,
    },
  });

  // Content policy (explicit)
  const explicit = caption ? isExplicit(caption) : false;
  const anyDisallow = users.some(
    (u) => u.id !== author.id && !u.allowExplicitContent
  );
  const cap = caption
    ? anyDisallow || !author.allowExplicitContent
      ? cleanText(caption)
      : caption
    : '';

  // Translation (skip in dev fallback)
  let translations = null;
  let translatedFrom = author.preferredLanguage || 'en';
  if (cap && !DEV_FALLBACKS) {
    const targetLangs = users
      .filter((u) => u.id !== author.id)
      .map((u) => u.preferredLanguage || 'en');
    const res = await translateForTargets(cap, translatedFrom, targetLangs);
    translations = Object.keys(res.map || {}).length ? res.map : null;
    translatedFrom = res.from || translatedFrom;
  }

  // Encryption (skip in dev fallback)
  let captionCiphertext = null;
  let encryptedKeys = {};
  if (!DEV_FALLBACKS) {
    const { ciphertext, encryptedKeys: keys } =
      await encryptMessageForParticipants(cap || '', author, users);
    captionCiphertext = ciphertext || null;
    encryptedKeys = keys || {};
  }

  // Fallback keys guarantee for non-EVERYONE audiences
  if (!isEveryone) {
    const targets = [author.id, ...audienceIds];
    for (const uid of targets) {
      if (!encryptedKeys[uid] && !encryptedKeys[String(uid)]) {
        encryptedKeys[uid] = 'self';
      }
    }
  }

  const secs = Math.max(5, Math.min(24 * 3600, Number(expireSeconds) || 24 * 3600));
  const expiresAt = new Date(Date.now() + secs * 1000);

  const saved = await prisma.status.create({
    data: {
      author: { connect: { id: author.id } },
      captionCiphertext,
      encryptedKeys: Object.keys(encryptedKeys).length ? encryptedKeys : null,
      translations,
      translatedFrom,
      isExplicit: explicit,
      audience: audienceEnum, // <-- Prisma expects EVERYONE/MUTUALS/CUSTOM/CONTACTS
      expiresAt,
      assets: files?.length
        ? {
            createMany: {
              data: files.map((a) => ({
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
    include: { assets: true },
  });

  // Persist envelope keys
  const entries = Object.entries(encryptedKeys || {});
  if (entries.length) {
    await prisma.$transaction(
      entries.map(([userIdStr, encKey]) =>
        prisma.statusKey.upsert({
          where: {
            statusId_userId: { statusId: saved.id, userId: Number(userIdStr) },
          },
          update: { encryptedKey: encKey },
          create: {
            statusId: saved.id,
            userId: Number(userIdStr),
            encryptedKey: encKey,
          },
        })
      )
    );
  }

  return saved;
}

export default { getAudienceUserIds, createStatusService };
