import OpenAI from 'openai';
import fs from 'node:fs';
import { mkdtemp, writeFile, rm, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '../../utils/r2.js';
import { cloudMessageMediaKey } from '../privateMessageMedia.js';

const MAX_BYTES = 24 * 1024 * 1024;

/**
 * Recognized Chatforia CDN references are storage keys, not public download
 * permissions. Transcription runs after message-level authorization; fetch
 * media using the server's R2 credentials instead of a public CDN request.
 */
export async function readPrivateCloudVoiceNote(value, { client = r2, bucket = process.env.R2_BUCKET } = {}) {
  const key = cloudMessageMediaKey(value);
  if (!key) {
    throw Object.assign(new Error('Audio unavailable'), { status: 422, code: 'UNSUPPORTED_MEDIA_ORIGIN' });
  }
  if (!bucket) {
    throw Object.assign(new Error('Private media storage unavailable'), { status: 503, code: 'PRIVATE_STORAGE_UNAVAILABLE' });
  }

  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (Number(object.ContentLength) > MAX_BYTES) {
    object.Body?.destroy?.();
    throw Object.assign(new Error('Audio too large'), { status: 413, code: 'AUDIO_TOO_LARGE' });
  }
  if (!object.Body) throw new Error('Audio unavailable');

  const chunks = [];
  let size = 0;
  for await (const chunk of object.Body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) {
      object.Body.destroy?.();
      throw Object.assign(new Error('Audio too large'), { status: 413, code: 'AUDIO_TOO_LARGE' });
    }
    chunks.push(bytes);
  }
  if (!size) throw new Error('Audio unavailable');
  return {
    buffer: Buffer.concat(chunks, size),
    mime: String(object.ContentType || '').split(';')[0].toLowerCase(),
  };
}
// Only configured media origins may be fetched. Never forward application credentials.
export function voiceNoteMediaURL(value, env = process.env) {
  const bases = [env.R2_PUBLIC_BASE, env.STORAGE_PUBLIC_BASE_URL, env.API_BASE_URL,
    env.PUBLIC_API_URL, ...(env.VOICE_NOTE_MEDIA_ORIGINS || '').split(',')].filter(Boolean);
  const allowed = new Set(['https://api.chatforia.com', ...bases.map(b => new URL(b).origin)]);
  const url = new URL(value, 'https://api.chatforia.com');
  if (url.protocol !== 'https:' || url.username || url.password || !allowed.has(url.origin)) {
    throw Object.assign(new Error('Media origin unavailable'), { status: 422, code: 'UNSUPPORTED_MEDIA_ORIGIN' });
  }
  return url;
}

export async function transcribeVoiceNote(value, language) {
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error('Provider not configured'), { code: 'TRANSCRIPTION_NOT_CONFIGURED' });
  let buffer;
  let mime = '';
  let extension = path.extname(String(value).split('?')[0]).toLowerCase();
  // Disk-uploaded message attachments are private relative paths, not public URLs.
  if (/^\/?media\/[A-Za-z0-9_.-]+$/.test(value)) {
    const root = await realpath(process.env.UPLOADS_DIR || path.resolve('uploads'));
    const filename = await realpath(path.join(root, String(value).replace(/^\//, '')));
    if (!filename.startsWith(root + path.sep) || (await stat(filename)).size > MAX_BYTES) throw new Error('Audio unavailable');
    buffer = await readFile(filename);
  } else if (cloudMessageMediaKey(value)) {
    const object = await readPrivateCloudVoiceNote(value);
    buffer = object.buffer;
    mime = object.mime;
  } else {
    const url = voiceNoteMediaURL(value);
    extension = path.extname(url.pathname).toLowerCase();
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Audio unavailable');
    mime = String(response.headers.get('content-type') || '').split(';')[0];
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw Object.assign(new Error('Audio too large'), { status: 413, code: 'AUDIO_TOO_LARGE' });
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  }
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('Audio unavailable');
  const byMime = { 'audio/mp4': '.m4a', 'audio/m4a': '.m4a', 'audio/x-m4a': '.m4a',
    'audio/mpeg': '.mp3', 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav' };
  const ext = byMime[mime] || (/^\.(m4a|mp3|mp4|webm|ogg|wav|flac)$/.test(extension) ? extension : null);
  if (!ext) throw Object.assign(new Error('Unsupported audio format'), { status: 422, code: 'UNSUPPORTED_AUDIO_FORMAT' });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chatforia-voice-note-'));
  try {
    const filename = path.join(directory, `audio${ext}`);
    await writeFile(filename, buffer, { mode: 0o600 });
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 0 });
    return await client.audio.transcriptions.create({ file: fs.createReadStream(filename), model: 'gpt-4o-transcribe', language: language.split('-')[0] });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
