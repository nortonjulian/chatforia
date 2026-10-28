import path from 'node:path';
import prisma from '../utils/prismaClient.js';

const PRIVATE_DIRECTORIES = new Set(['media', 'thumbs']);

/**
 * Accept only the legacy local paths created by message/stories upload code.
 * A cloud URL, absolute filesystem path or an encoded traversal is never a
 * local download claim.
 */
export function localMessageMediaPath(value) {
  if (typeof value !== 'string') return null;
  let raw = value.trim().replaceAll('\\', '/');
  if (raw.startsWith('/uploads/')) raw = raw.slice('/uploads/'.length);
  else if (raw.startsWith('uploads/')) raw = raw.slice('uploads/'.length);
  else if (raw.startsWith('/')) raw = raw.slice(1);
  const parts = raw.split('/');
  if (parts.length !== 2 || !PRIVATE_DIRECTORIES.has(parts[0]) ||
      !/^[a-zA-Z0-9_.-]{1,200}$/.test(parts[1]) ||
      parts[1] === '.' || parts[1] === '..') return null;
  return parts.join('/');
}


/**
 * The legacy CDN custom domain was publicly reachable. Resolve only keys
 * from Chatforia's own message uploads; never authorize arbitrary remote URLs.
 * The attachment database record, not the key owner, determines membership.
 */
export function cloudMessageMediaKey(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  let key;

  // /uploads/intent + /uploads/complete return storage keys, and web
  // MessageInput persists the key instead of a public CDN URL.
  if (raw.startsWith('uploads/')) {
    key = raw;
  } else {
    // Check the unnormalized URL first: URL() silently resolves dot segments.
    // Never accept encoded path components or path traversal as storage keys.
    if (raw.includes('%') || raw.includes('\\')) return null;
    let url;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.chatforia.com' ||
        url.port || url.username || url.password || url.search || url.hash) return null;
    key = url.pathname.replace(/^\//, '');
  }

  // Only canonical user-scoped upload keys are eligible. Membership and
  // deletion authorization still happen independently on the attachment row.
  if (key.includes('%') || key.includes('\\') || key.includes('?') || key.includes('#')) return null;
  const parts = key.split('/');
  if (parts.length < 3 || parts[0] !== 'uploads' ||
      !/^u[1-9][0-9]*$/.test(parts[1]) ||
      parts.slice(2).some(part => !/^[a-zA-Z0-9._-]{1,200}$/.test(part) ||
        part === '.' || part === '..')) return null;
  return key;
}

function after(date, other) {
  const time = date ? new Date(date).getTime() : NaN;
  const otherTime = other ? new Date(other).getTime() : NaN;
  return Number.isFinite(time) && Number.isFinite(otherTime) && time >= otherTime;
}

/**
 * Authorize every issuance AND download against live canonical records.
 * Never trust a signed URL to override message deletion/expiration, account
 * clearing or room membership changes after the URL was generated.
 */
export async function getAuthorizedMessageMedia({
  attachmentId,
  viewerId,
  variant = 'file',
  db = prisma,
  now = new Date(),
}) {
  const id = Number(attachmentId);
  const userId = Number(viewerId);
  if (!Number.isSafeInteger(id) || id <= 0 ||
      !Number.isSafeInteger(userId) || userId <= 0 ||
      !['file', 'thumb'].includes(variant)) return null;

  const attachment = await db.messageAttachment.findUnique({
    where: { id },
    select: {
      id: true,
      url: true,
      thumbUrl: true,
      deletedAt: true,
      message: {
        select: {
          id: true,
          chatRoomId: true,
          senderId: true,
          createdAt: true,
          expiresAt: true,
          deletedForAll: true,
          deletedBySender: true,
          deletions: {
            where: { userId },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  const message = attachment?.message;
  if (!message || attachment.deletedAt || message.deletedForAll ||
      (message.deletedBySender && Number(message.senderId) === userId) ||
      message.deletions?.length ||
      (message.expiresAt && new Date(message.expiresAt) <= now)) return null;

  const membership = await db.participant.findUnique({
    where: { chatRoomId_userId: { chatRoomId: message.chatRoomId, userId } },
    select: { id: true, clearedAt: true },
  });
  if (!membership || after(membership.clearedAt, message.createdAt)) return null;

  const threadState = await db.threadState.findUnique({
    where: { userId_chatRoomId: { userId, chatRoomId: message.chatRoomId } },
    select: { deletedAt: true },
  });
  if (after(threadState?.deletedAt, message.createdAt)) return null;

  const mediaReference = variant === 'thumb' ? attachment.thumbUrl : attachment.url;
  const relativePath = localMessageMediaPath(mediaReference);
  const storageKey = cloudMessageMediaKey(mediaReference);
  if (!relativePath && !storageKey) return null;
  return {
    relativePath,
    storageKey,
    attachmentId: id,
    viewerId: userId,
    variant,
    chatRoomId: message.chatRoomId,
  };
}

export function localMessageMediaAbsolutePath(relativePath, root) {
  const normalized = localMessageMediaPath(relativePath);
  if (!normalized) return null;
  const storageRoot = path.resolve(root);
  const abs = path.resolve(storageRoot, normalized);
  const relative = path.relative(storageRoot, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative) return null;
  return abs;
}
