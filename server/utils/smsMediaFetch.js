import Boom from '@hapi/boom';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from './r2.js';
import { fetchTwilioMedia } from './twilioMediaProxy.js';

// Call only after the message/thread ownership check in /sms/media/:id/:index.
// Storage media must never receive Twilio Basic Auth or follow a redirect.
export async function fetchSMSMedia(value) {
  // Reject traversal before URL parsing normalizes dot segments.
  if (typeof value !== 'string') {
    throw Boom.badRequest('Invalid media URL');
  }

  const rawPath = value.replace(/^https:\/\/[^/?#]+/i, '').split(/[?#]/, 1)[0];
  const segments = rawPath.split('/');

  if (segments.some((segment) => {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    return decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\');
  })) {
    throw Boom.badRequest('Invalid media URL');
  }

  let url;
  try { url = new URL(value); } catch { throw Boom.badRequest('Invalid media URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw Boom.badRequest('Invalid media URL');
  }

  if (/^api(?:\.[a-z0-9-]+){0,2}\.twilio\.com$/i.test(url.hostname)) {
    if (url.port) throw Boom.badRequest('Invalid Twilio media port');
    const sid = process.env.TWILIO_ACCOUNT_SID;
    if (!sid || !url.pathname.startsWith(`/2010-04-01/Accounts/${sid}/Messages/`)) {
      throw Boom.forbidden('Media account mismatch');
    }
    return fetchTwilioMedia(url.href);
  }

  let base;
  try { base = new URL(process.env.R2_PUBLIC_BASE); } catch {
    throw Boom.badRequest('Unsupported media origin');
  }
  const prefix = base.pathname.replace(/\/$/, '') + '/';
  if (base.protocol !== 'https:' || base.username || base.password ||
      url.origin !== base.origin || !url.pathname.startsWith(prefix)) {
    throw Boom.badRequest('Unsupported media origin');
  }
  // Stored SMS/MMS objects are private. The authorized SMS proxy
  // retrieves them directly from R2, never through the public CDN.
  if (url.search || base.search || base.hash || base.port) {
    throw Boom.badRequest('Invalid stored media URL');
  }

  const encodedKey = url.pathname.slice(prefix.length);
  if (!encodedKey || /%2f|%5c/i.test(encodedKey)) {
    throw Boom.badRequest('Invalid stored media key');
  }

  let key;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    throw Boom.badRequest('Invalid stored media key');
  }

  if (
    !key ||
    key.includes('\\') ||
    key.startsWith('/') ||
    key.split('/').some((segment) =>
      !segment || segment === '.' || segment === '..'
    )
  ) {
    throw Boom.badRequest('Invalid stored media key');
  }

  const bucket = process.env.R2_BUCKET?.trim();
  if (!bucket) throw Boom.badGateway('Media storage unavailable');

  let object;
  try {
    object = await r2.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 ||
        error?.name === 'NoSuchKey') {
      throw Boom.notFound('Stored media not found');
    }
    throw Boom.badGateway('Failed to fetch stored media');
  }

  if (!object?.Body || typeof object.Body.pipe !== 'function') {
    object?.Body?.destroy?.();
    throw Boom.badGateway('Invalid stored media stream');
  }

  // Preserve the interface consumed by the existing SMS media route.
  // Do not buffer the object: photos and videos can be much larger.
  return {
    ok: true,
    headers: new Headers({
      'content-type': object.ContentType || 'application/octet-stream',
      ...(object.ContentLength != null
        ? { 'content-length': String(object.ContentLength) }
        : {}),
    }),
    body: object.Body,
  };
}
