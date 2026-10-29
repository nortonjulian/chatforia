/** @jest-environment node */
import { jest, describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const previousBase = process.env.R2_PUBLIC_BASE;
const previousBucket = process.env.R2_BUCKET;
const previousSid = process.env.TWILIO_ACCOUNT_SID;

process.env.R2_PUBLIC_BASE = 'https://cdn.chatforia.com/';
process.env.R2_BUCKET = 'test-media-bucket';
process.env.TWILIO_ACCOUNT_SID = 'AC123456789';

const sendMock = jest.fn();
const twilioMock = jest.fn();

await jest.unstable_mockModule('../utils/r2.js', () => ({
  r2: { send: sendMock },
}));

await jest.unstable_mockModule('../utils/twilioMediaProxy.js', () => ({
  fetchTwilioMedia: twilioMock,
}));

const { fetchSMSMedia } = await import('../utils/smsMediaFetch.js');

const storedUrl = 'https://cdn.chatforia.com/sms/audio/sample.m4a';

beforeEach(() => {
  jest.clearAllMocks();
  sendMock.mockResolvedValue({
    Body: Readable.from([Buffer.from('audio-fixture')]),
    ContentType: 'audio/mp4',
    ContentLength: 13,
  });
});

afterAll(() => {
  if (previousBase === undefined) delete process.env.R2_PUBLIC_BASE;
  else process.env.R2_PUBLIC_BASE = previousBase;

  if (previousBucket === undefined) delete process.env.R2_BUCKET;
  else process.env.R2_BUCKET = previousBucket;

  if (previousSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
  else process.env.TWILIO_ACCOUNT_SID = previousSid;
});

describe('SMS stored-media R2 retrieval', () => {
  test('retrieves audio from authenticated R2 and preserves metadata', async () => {
    const result = await fetchSMSMedia(storedUrl);

    expect(result.ok).toBe(true);
    expect(result.headers.get('content-type')).toBe('audio/mp4');
    expect(result.headers.get('content-length')).toBe('13');

    expect(sendMock).toHaveBeenCalledTimes(1);

    const command = sendMock.mock.calls[0][0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'test-media-bucket',
      Key: 'sms/audio/sample.m4a',
    });

    const chunks = [];
    for await (const chunk of result.body) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('audio-fixture');

    expect(twilioMock).not.toHaveBeenCalled();
  });

  test('rejects unrecognized media origins before R2 access', async () => {
    await expect(
      fetchSMSMedia('https://example.com/sms/audio/sample.m4a')
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
    });

    expect(sendMock).not.toHaveBeenCalled();
  });

  test('rejects encoded traversal before R2 access', async () => {
    await expect(
      fetchSMSMedia('https://cdn.chatforia.com/sms/%2e%2e/private.m4a')
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
    });

    expect(sendMock).not.toHaveBeenCalled();
  });

  test('returns 404 when the R2 object is missing', async () => {
    sendMock.mockRejectedValueOnce({
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });

    await expect(fetchSMSMedia(storedUrl)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  test('returns 502 without exposing R2 errors', async () => {
    sendMock.mockRejectedValueOnce(new Error('secret storage detail'));

    await expect(fetchSMSMedia(storedUrl)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });

  test('preserves the existing Twilio retrieval path', async () => {
    const url =
      'https://api.twilio.com/2010-04-01/Accounts/AC123456789/Messages/SM123/Media/ME123';

    const fixture = new Response('twilio-fixture');
    twilioMock.mockResolvedValueOnce(fixture);

    const result = await fetchSMSMedia(url);

    expect(result).toBe(fixture);
    expect(twilioMock).toHaveBeenCalledWith(url);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
