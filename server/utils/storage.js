import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Generic S3/R2 client.
 * Configure via env:
 * - STORAGE_ENDPOINT (optional, e.g. R2 endpoint)
 * - STORAGE_REGION
 * - STORAGE_BUCKET
 * - STORAGE_ACCESS_KEY_ID
 * - STORAGE_SECRET_ACCESS_KEY
 * - STORAGE_PUBLIC_BASE_URL (optional; if not set, we build a default)
 */
const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT || undefined,
  region: process.env.STORAGE_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
  },
  forcePathStyle: true, // good for R2/minio-style endpoints
});

/**
 * Upload a Buffer to the configured storage (used by server-side flows).
 * Returns the public URL (constructed) — note: for private buckets you may prefer signed urls.
 */
export async function uploadBufferToStorage({ key, buffer, contentType }) {
  const Bucket = process.env.STORAGE_BUCKET;
  if (!Bucket) {
    throw new Error('STORAGE_BUCKET is not set');
  }

  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
      ACL: 'public-read', // remove/adjust if you’re using signed URLs instead
    }),
  );

  const base =
    process.env.STORAGE_PUBLIC_BASE_URL ||
    `https://${Bucket}.s3.${process.env.STORAGE_REGION || 'auto'}.amazonaws.com`;

  return `${base}/${encodeURIComponent(key)}`;
}

/**
 * Generate a presigned PUT URL for direct client uploads.
 * - key: desired object key (string)
 * - expiresIn: seconds (<= 3600 recommended)
 *
 * Works with AWS S3 and Cloudflare R2 (S3-compatible).
 */
export async function generatePresignedPutUrl({ key, contentType = 'application/octet-stream', expiresIn = 300 }) {
  const Bucket = process.env.STORAGE_BUCKET;
  if (!Bucket) throw new Error('STORAGE_BUCKET is not set');

  const cmd = new PutObjectCommand({
    Bucket,
    Key: key,
    ContentType: contentType,
    ACL: process.env.STORAGE_PUBLIC_READ === 'true' ? 'public-read' : undefined,
  });

  const url = await getSignedUrl(s3, cmd, { expiresIn });
  return { url, key, expiresIn };
}

/**
 * Build a public URL for an object key. If STORAGE_PUBLIC_BASE_URL is set,
 * uses that; otherwise falls back to standard s3-style URL.
 */
export function buildPublicUrlForKey(key) {
  const base = process.env.STORAGE_PUBLIC_BASE_URL;
  if (base) {
    // ensure no double slashes
    return `${base.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
  }
  const Bucket = process.env.STORAGE_BUCKET;
  const region = process.env.STORAGE_REGION || 'auto';
  return `https://${Bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`;
}

export default s3;