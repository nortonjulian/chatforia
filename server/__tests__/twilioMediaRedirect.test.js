/** @jest-environment node */
import { jest, describe, test, expect, afterEach } from '@jest/globals';
import { fetchTwilioMedia } from '../utils/twilioMediaProxy.js';

const originalFetch = global.fetch;
const originalSid = process.env.TWILIO_ACCOUNT_SID;
const originalToken = process.env.TWILIO_AUTH_TOKEN;
const sid = 'test-account';
const sourceUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/example/Media/example`;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
  else process.env.TWILIO_ACCOUNT_SID = originalSid;
  if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = originalToken;
});
const configure = () => {
  process.env.TWILIO_ACCOUNT_SID = sid;
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
};

describe('Twilio MMS redirect security', () => {
  test('direct media authenticates only to Twilio', async () => {
    configure();
    const direct = new Response('picture', { status: 200 });
    global.fetch = jest.fn(async () => direct);
    expect(await fetchTwilioMedia(sourceUrl)).toBe(direct);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1]).toMatchObject({
      redirect: 'manual', headers: { Authorization: expect.stringMatching(/^Basic /) },
    });
  });

  test('valid Twilio CDN redirect strips credentials', async () => {
    configure();
    const target = 'https://mms.twiliocdn.com/example';
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: target } }))
      .mockResolvedValueOnce(new Response('media bytes', { status: 200 }));
    const response = await fetchTwilioMedia(sourceUrl);
    expect(await response.text()).toBe('media bytes');
    expect(global.fetch.mock.calls[1]).toEqual([target, { redirect: 'manual' }]);
  });

  test.each([
    'http://mms.twiliocdn.com/media',
    'https://mms.twiliocdn.com.evil.test/media',
    'https://evil.test/media',
    'https://user:pass@mms.twiliocdn.com/media',
    'https://mms.twiliocdn.com:8443/media',
    '/relative-media-path',
  ])('rejects unsafe redirect %s', async (target) => {
    configure();
    global.fetch = jest.fn(async () => new Response(null, {
      status: 302, headers: { location: target },
    }));
    await expect(fetchTwilioMedia(sourceUrl)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('refuses a second CDN redirect', async () => {
    configure();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://mms.twiliocdn.com/example' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://evil.test/trap' } }));
    await expect(fetchTwilioMedia(sourceUrl)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
