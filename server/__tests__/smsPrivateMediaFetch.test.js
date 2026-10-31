/** @jest-environment node */
import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import { Readable } from 'node:stream';

const send = jest.fn();
const fetchTwilioMedia = jest.fn();

jest.unstable_mockModule('../utils/r2.js', () => ({
  r2: { send },
}));
jest.unstable_mockModule('../utils/twilioMediaProxy.js', () => ({
  fetchTwilioMedia,
}));

const { fetchSMSMedia } = await import('../utils/smsMediaFetch.js');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.R2_BUCKET = 'private-qa-bucket';
  process.env.R2_PUBLIC_BASE = 'https://cdn.chatforia.com';
  send.mockResolvedValue({
    Body: Readable.from([Buffer.from('photo')]),
    ContentType: 'image/jpeg',
    ContentLength: 5,
  });
});

describe('secure SMS media retrieval', () => {
  test('fetches an authorized outgoing MMS private key directly from R2', async () => {
    const result = await fetchSMSMedia(
      'uploads/u65/2026/10/30/photo.jpg',
      { ownerId: 65 }
    );
    expect(result.ok).toBe(true);
    expect(result.headers.get('content-type')).toBe('image/jpeg');
    expect(result.headers.get('content-length')).toBe('5');
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input).toEqual({
      Bucket: 'private-qa-bucket',
      Key: 'uploads/u65/2026/10/30/photo.jpg',
    });
    expect(fetchTwilioMedia).not.toHaveBeenCalled();
    result.body.destroy();
  });

  test('rejects other owners before retrieving private media', async () => {
    await expect(fetchSMSMedia(
      'uploads/u65/2026/10/30/photo.jpg',
      { ownerId: 1 }
    )).rejects.toThrow('Media owner mismatch');
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects a private key without an authenticated owner', async () => {
    await expect(fetchSMSMedia(
      'uploads/u65/photo.jpg'
    )).rejects.toThrow('Media owner mismatch');
    expect(send).not.toHaveBeenCalled();
  });

  test.each([
    'uploads/u65/../secret',
    'uploads/u65/%2e%2e/secret',
    'uploads/u65//photo.jpg',
    'uploads/u65/./photo.jpg',
    'uploads/u65/photo.jpg?token=secret',
    'uploads/u65/photo.jpg#token',
    'uploads/u65/hello\\world.jpg',
    'uploads/u0/valid.jpg',
    'uploads/u65/https://evil.test/',
  ])('rejects malformed private key %s', async value => {
    await expect(fetchSMSMedia(value, { ownerId: 65 }))
      .rejects.toThrow('Invalid stored media key');
    expect(send).not.toHaveBeenCalled();
  });

  test('retains legacy HTTPS R2 media retrieval', async () => {
    const result = await fetchSMSMedia(
      'https://cdn.chatforia.com/uploads/u65/old-photo.jpg',
      { ownerId: 65 }
    );
    expect(result.ok).toBe(true);
    expect(send.mock.calls[0][0].input.Key)
      .toBe('uploads/u65/old-photo.jpg');
    result.body.destroy();
  });

  test('rejects unrelated or unsafe HTTPS sources', async () => {
    for (const url of [
      'https://evil.test/uploads/u65/file.jpg',
      'http://cdn.chatforia.com/uploads/u65/file.jpg',
      'https://cdn.chatforia.com/uploads/u65/%2e%2e/file.jpg',
    ]) {
      await expect(fetchSMSMedia(url, { ownerId: 65 })).rejects.toThrow();
    }
    expect(send).not.toHaveBeenCalled();
  });
});
