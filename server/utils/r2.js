import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID?.trim();
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY?.trim();
const R2_S3_ENDPOINT = process.env.R2_S3_ENDPOINT?.trim();
const R2_BUCKET = process.env.R2_BUCKET?.trim();
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE?.trim();

console.log('[R2 config check]', {
  hasAccessKeyId: !!R2_ACCESS_KEY_ID,
  accessKeyIdLength: R2_ACCESS_KEY_ID?.length ?? 0,
  hasSecretAccessKey: !!R2_SECRET_ACCESS_KEY,
  secretAccessKeyLength: R2_SECRET_ACCESS_KEY?.length ?? 0,
  endpoint: R2_S3_ENDPOINT,
  bucket: R2_BUCKET,
});

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_S3_ENDPOINT) {
  console.warn('[R2] Missing env vars – R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_S3_ENDPOINT');
}
if (!R2_BUCKET) {
  console.warn('[R2] Missing env var R2_BUCKET – operations will fail without it.');
}

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_S3_ENDPOINT}`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export async function r2PutObject({
  key,
  body,
  contentType = 'application/octet-stream',
  cacheControl,
  contentDisposition,
}) {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
    ContentDisposition: contentDisposition,
  });
  return r2.send(cmd);
}

export async function r2PresignGet({
  key,
  expiresSec = 300,
  responseContentType,
  responseDisposition,
}) {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ResponseContentType: responseContentType,
    ResponseContentDisposition: responseDisposition,
  });
  return getSignedUrl(r2, cmd, { expiresIn: expiresSec });
}

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

export function r2PublicUrl(key) {
  if (!R2_PUBLIC_BASE) return null;
  return `${R2_PUBLIC_BASE.replace(/\/$/, '')}/${String(key).replace(/^\//, '')}`;
}