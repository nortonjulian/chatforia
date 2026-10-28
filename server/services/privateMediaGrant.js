import jwt from 'jsonwebtoken';
import { getAuthorizedMessageMedia } from './privateMessageMedia.js';

export const PRIVATE_MEDIA_GRANT_SECONDS = 60;

export function privateMediaTokenSecret() {
  if (process.env.FILE_TOKEN_SECRET) return process.env.FILE_TOKEN_SECRET;
  if (process.env.NODE_ENV === 'test') return 'test-secret';
  throw new Error('FILE_TOKEN_SECRET is required');
}

/**
 * Authorize against the current attachment/message state before creating
 * a short-lived token. The download route performs this check again on use.
 */
export async function issuePrivateMediaGrant({
  attachmentId,
  viewerId,
  variant = 'file',
  expectedStorageKey = null,
}) {
  const claim = await getAuthorizedMessageMedia({ attachmentId, viewerId, variant });
  if (!claim || (expectedStorageKey !== null && claim.storageKey !== expectedStorageKey)) {
    return null;
  }
  const token = jwt.sign(
    { aid: claim.attachmentId, uid: claim.viewerId, v: variant, aud: 'private-media', iss: 'chatforia' },
    privateMediaTokenSecret(),
    { expiresIn: PRIVATE_MEDIA_GRANT_SECONDS }
  );
  return {
    url: `/private-media/file?token=${encodeURIComponent(token)}`,
    expiresSec: PRIVATE_MEDIA_GRANT_SECONDS,
  };
}
