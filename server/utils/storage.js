import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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

  // If you have a CDN/public base URL, use that:
  const base =
    process.env.STORAGE_PUBLIC_BASE_URL ||
    // fallback: basic S3-style URL (you can ignore if using R2+CDN)
    `https://${Bucket}.s3.${process.env.STORAGE_REGION || 'auto'}.amazonaws.com`;

  return `${base}/${key}`;
}
