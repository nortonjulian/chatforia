/** @jest-environment node */
import { jest, describe, test, expect } from '@jest/globals';
import { Readable } from 'node:stream';
import { readPrivateCloudVoiceNote } from '../services/stt/voiceNote.js';

const voiceUrl = 'https://cdn.chatforia.com/uploads/u7/voice.webm';
const bucket = 'fixture-private-bucket';
const makeClient = (object) => ({ send: jest.fn(async () => object) });

describe('private R2 voice-note transcription input', () => {
  test('reads a recognized voice note using R2 credentials without contacting its CDN', async () => {
    const client = makeClient({
      ContentType: 'audio/webm;codecs=opus',
      ContentLength: 11,
      Body: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
    });
    const originalFetch = global.fetch;
    const network = jest.fn(async () => { throw new Error('Public CDN must not be fetched'); });
    global.fetch = network;
    try {
      const media = await readPrivateCloudVoiceNote(voiceUrl, { client, bucket });
      expect(media.buffer.toString()).toBe('hello world');
      expect(media.mime).toBe('audio/webm');
      expect(client.send).toHaveBeenCalledTimes(1);
      expect(client.send.mock.calls[0][0].input).toMatchObject({
        Bucket: bucket, Key: 'uploads/u7/voice.webm',
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  test.each([
    'https://evil.test/uploads/u7/voice.webm',
    'https://cdn.chatforia.com/uploads/u7/%2e%2e/voice.webm',
    'http://cdn.chatforia.com/uploads/u7/voice.webm',
    'https://cdn.chatforia.com/uploads/u7/voice.webm?token=secret',
  ])('rejects noncanonical object reference: %s', async (value) => {
    const client = makeClient(null);
    await expect(readPrivateCloudVoiceNote(value, { client, bucket }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_ORIGIN' });
    expect(client.send).not.toHaveBeenCalled();
  });

  test('missing private bucket fails closed without network fallback', async () => {
    const client = makeClient(null);
    await expect(readPrivateCloudVoiceNote(voiceUrl, { client, bucket: '' }))
      .rejects.toMatchObject({ code: 'PRIVATE_STORAGE_UNAVAILABLE' });
    expect(client.send).not.toHaveBeenCalled();
  });

  test('rejects object exceeding declared 24 MiB limit', async () => {
    const body = Readable.from([Buffer.from('no private bytes disclosed')]);
    const client = makeClient({ ContentLength: 24 * 1024 * 1024 + 1, Body: body });
    await expect(readPrivateCloudVoiceNote(voiceUrl, { client, bucket }))
      .rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE' });
    expect(body.destroyed).toBe(true);
  });

  test('rejects oversized streaming body even when ContentLength is absent', async () => {
    const client = makeClient({
      ContentType: 'audio/webm',
      Body: Readable.from([Buffer.alloc(24 * 1024 * 1024 + 1)]),
    });
    await expect(readPrivateCloudVoiceNote(voiceUrl, { client, bucket }))
      .rejects.toMatchObject({ code: 'AUDIO_TOO_LARGE' });
  });

  test('missing object body is unavailable', async () => {
    const client = makeClient({ ContentType: 'audio/webm' });
    await expect(readPrivateCloudVoiceNote(voiceUrl, { client, bucket }))
      .rejects.toThrow('Audio unavailable');
  });
});
