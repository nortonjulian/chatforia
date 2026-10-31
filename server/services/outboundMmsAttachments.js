import Boom from '@hapi/boom';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'video/mp4',
]);

// Twilio MMS has a 5,000,000 byte aggregate ceiling including the body.
// Non-image video is less portable across carriers; use the conservative
// 500 KB API guidance until transcode/carrier-specific QA is complete.
export const MAX_MMS_ATTACHMENT_BYTES = 5_000_000;
export const MAX_MMS_NON_IMAGE_BYTES = 500_000;

export async function authorizeOutboundMmsAttachments({
  prisma,
  userId,
  mediaRefs,
  presignGet,
  publicBase,
  expiresSec = 3600,
  body = '',
}) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
    throw Boom.badRequest('Invalid sender');
  }

  if (!Array.isArray(mediaRefs) ||
      mediaRefs.length < 1 ||
      mediaRefs.length > 5) {
    throw Boom.badRequest('Invalid MMS attachments');
  }

  if (typeof presignGet !== 'function') {
    throw new Error('MMS signing service unavailable');
  }

  const base = typeof publicBase === 'string'
    ? publicBase.replace(/\/+$/, '')
    : '';

  const baseURL = base ? new URL(base) : null;

  if (baseURL &&
      (baseURL.protocol !== 'https:' ||
       baseURL.username ||
       baseURL.password ||
       baseURL.search ||
       baseURL.hash)) {
    throw new Error('Invalid MMS media base URL');
  }

  const seen = new Set();
  const uploads = [];
  const textBytes = Buffer.byteLength(String(body ?? ''), 'utf8');
  let totalBytes = textBytes;
  if (totalBytes >= MAX_MMS_ATTACHMENT_BYTES) {
    throw Boom.badRequest('MMS text exceeds the 5 MB combined message limit');
  }

  // Authorize every item before generating any delivery URLs.
  for (const reference of mediaRefs) {
    if (typeof reference !== 'string' || !reference.trim()) {
      throw Boom.badRequest('Invalid MMS media reference');
    }

    let key = reference.trim();

    if (key.startsWith('https://')) {
      if (!baseURL) {
        throw Boom.badRequest('Unsupported MMS media URL');
      }

      const url = new URL(key);

      if (url.origin !== baseURL.origin ||
          url.search ||
          url.hash ||
          !url.pathname.startsWith(`${baseURL.pathname.replace(/\/$/, '')}/`)) {
        throw Boom.badRequest('Unsupported MMS media URL');
      }

      const encodedKey = url.pathname.slice(
        baseURL.pathname.replace(/\/$/, '').length + 1
      );

      if (/%2f|%5c/i.test(encodedKey)) {
        throw Boom.badRequest('Invalid MMS storage key');
      }

      try {
        key = decodeURIComponent(encodedKey);
      } catch {
        throw Boom.badRequest('Invalid MMS storage key');
      }
    }

    if (!/^uploads\/u[1-9]\d*\//.test(key) ||
        !key.startsWith(`uploads/u${Number(userId)}/`) ||
        key.includes('\\') ||
        key.split('/').some(s => s === '.' || s === '..' || !s)) {
      throw Boom.badRequest('Invalid MMS storage key');
    }

    if (seen.has(key)) {
      throw Boom.badRequest('Duplicate MMS attachment');
    }
    seen.add(key);

    const upload = await prisma.upload.findFirst({
      where: {
        ownerId: Number(userId),
        key,
        driver: 's3',
      },
      select: {
        key: true,
        mimeType: true,
        size: true,
      },
    });

    if (!upload) {
      throw Boom.forbidden('MMS attachment not owned by sender');
    }

    if (!ALLOWED_TYPES.has(upload.mimeType) ||
        !Number.isSafeInteger(upload.size) ||
        upload.size <= 0) {
      throw Boom.badRequest('Unsupported MMS attachment type or size');
    }

    const maxFileBytes = upload.mimeType === 'video/mp4'
      ? MAX_MMS_NON_IMAGE_BYTES
      : MAX_MMS_ATTACHMENT_BYTES;
    if (upload.size > maxFileBytes) {
      throw Boom.badRequest(upload.mimeType === 'video/mp4'
        ? 'MMS video must be 500 KB or smaller for carrier compatibility'
        : 'MMS image exceeds the 5 MB message limit');
    }
    totalBytes += upload.size;
    if (totalBytes > MAX_MMS_ATTACHMENT_BYTES) {
      throw Boom.badRequest('Combined MMS attachments and text exceed 5 MB');
    }

    uploads.push(upload);
  }

  const providerUrls = [];
  const storedUrls = [];

  for (const upload of uploads) {
    providerUrls.push(await presignGet({
      key: upload.key,
      expiresSec,
      responseContentType: upload.mimeType,
    }));

    // Persist the canonical key, never a publicly fetchable URL.
    storedUrls.push(upload.key);
  }

  return { providerUrls, storedUrls };
}
