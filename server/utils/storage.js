import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const STORAGE_ENDPOINT =
  process.env.R2_S3_ENDPOINT ||
  process.env.STORAGE_ENDPOINT;

const STORAGE_REGION =
  process.env.R2_REGION ||
  process.env.STORAGE_REGION ||
  'auto';

const STORAGE_BUCKET =
  process.env.R2_BUCKET ||
  process.env.STORAGE_BUCKET;

const STORAGE_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID ||
  process.env.STORAGE_ACCESS_KEY_ID ||
  '';

const STORAGE_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY ||
  process.env.STORAGE_SECRET_ACCESS_KEY ||
  '';

const STORAGE_PUBLIC_BASE =
  process.env.R2_PUBLIC_BASE ||
  process.env.STORAGE_PUBLIC_BASE_URL;

const s3 = new S3Client({
  endpoint: STORAGE_ENDPOINT || undefined,
  region: STORAGE_REGION,
  credentials: {
    accessKeyId: STORAGE_ACCESS_KEY_ID,
    secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

export async function uploadBufferToStorage({ key, buffer, contentType }) {
  const Bucket = STORAGE_BUCKET;
  if (!Bucket) {
    throw new Error('R2_BUCKET/STORAGE_BUCKET is not set');
  }

  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }),
  );

  return buildPublicUrlForKey(key);
}

export async function generatePresignedPutUrl({
  key,
  contentType = 'application/octet-stream',
  expiresIn = 300,
}) {
  const Bucket = STORAGE_BUCKET;
  if (!Bucket) {
    throw new Error('R2_BUCKET/STORAGE_BUCKET is not set');
  }

  const cmd = new PutObjectCommand({
    Bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3, cmd, { expiresIn });

  return { url, key, expiresIn };
}

export function buildPublicUrlForKey(key) {
  const encodedKey = key
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  if (STORAGE_PUBLIC_BASE) {
    return `${STORAGE_PUBLIC_BASE.replace(/\/$/, '')}/${encodedKey}`;
  }

  const Bucket = STORAGE_BUCKET;
  if (!Bucket) {
    throw new Error('R2_BUCKET/STORAGE_BUCKET is not set');
  }

  const region = STORAGE_REGION;

  return `https://${Bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export default s3;