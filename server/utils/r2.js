import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_S3_ENDPOINT,   // e.g. <accountId>.r2.cloudflarestorage.com
  R2_BUCKET,        // e.g. 'chatforia-prod'
  R2_PUBLIC_BASE,   // e.g. 'https://media.chatforia.com' (optional)
} = process.env;

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_S3_ENDPOINT) {
  console.warn('[R2] Missing env vars – R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_S3_ENDPOINT');
}
if (!R2_BUCKET) {
  console.warn('[R2] Missing env var R2_BUCKET – operations will fail without it.');
}

// Single S3-compatible client for R2
export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_S3_ENDPOINT}`,
  forcePathStyle: true, // IMPORTANT for R2
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload an object to R2
 */
export async function r2PutObject({
  key,
  body,
  contentType = 'application/octet-stream',
  cacheControl,               // e.g. 'public, max-age=31536000, immutable'
  contentDisposition,         // e.g. 'inline' or 'attachment; filename="..."'
  acl = 'public-read',        // ignored by R2 when using custom domains, harmless to include
}) {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
    ContentDisposition: contentDisposition,
    ACL: acl,
  });
  return r2.send(cmd);
}

/**
 * Generate a signed URL for GET (useful if your bucket is private)
 */
export async function r2PresignGet({ key, expiresSec = 300, responseContentType, responseDisposition }) {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ResponseContentType: responseContentType,
    ResponseContentDisposition: responseDisposition,
  });
  return getSignedUrl(r2, cmd, { expiresIn: expiresSec });
}

/**
 * Generate a signed URL for PUT (browser/client direct upload)
 */
export async function r2PresignPut({
  key,
  contentType = 'application/octet-stream',
  expiresSec = 300,
  cacheControl,
  contentDisposition,
}) {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
    CacheControl: cacheControl,
    ContentDisposition: contentDisposition,
  });
  return getSignedUrl(r2, cmd, { expiresIn: expiresSec });
}

/**
 * Build a public URL for an object if you have a CDN/custom domain in front of the bucket.
 * Falls back to null if R2_PUBLIC_BASE isn't set.
 */
export function r2PublicUrl(key) {
  if (!R2_PUBLIC_BASE) return null;
  // Ensure single slash
  return `${R2_PUBLIC_BASE.replace(/\/$/, '')}/${String(key).replace(/^\//, '')}`;
}
