/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

const fetchMock = jest.fn();

const telnaConfig = {
  apiKey: 'test-api-key',
  baseUrl: 'https://api.telna.test',
};

await jest.unstable_mockModule('node-fetch', () => ({
  __esModule: true,
  default: fetchMock,
}));

await jest.unstable_mockModule('../config/esim.js', () => ({
  __esModule: true,
  getEsimProviderConfig: jest.fn(() => telnaConfig),
}));

const { telnaRequest } = await import('../telnaClient.js');

describe('telnaRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    telnaConfig.apiKey = 'test-api-key';
    telnaConfig.baseUrl = 'https://api.telna.test';
    delete telnaConfig.username;
    delete telnaConfig.password;
  });

  it('throws if Telna baseUrl is missing', async () => {
    telnaConfig.baseUrl = null;

    await expect(telnaRequest('/esim/test')).rejects.toThrow(
      'TELNA.baseUrl is not configured'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses TELNA.baseUrl and sends JSON body + headers', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValueOnce(JSON.stringify({ ok: true, foo: 'bar' })),
    });

    const result = await telnaRequest('/esim/reserve', {
      method: 'POST',
      body: { a: 1, b: 'two' },
      attempts: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];

    expect(url).toBe('https://api.telna.test/esim/reserve');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({
      Authorization: 'Bearer test-api-key',
      'Content-Type': 'application/json',
    });
    expect(opts.body).toBe(JSON.stringify({ a: 1, b: 'two' }));
    expect(opts.signal).toBeDefined();

    expect(result).toEqual({ ok: true, foo: 'bar' });
  });

  it('defaults method to GET and omits body when none provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValueOnce(JSON.stringify({ hello: 'world' })),
    });

    const result = await telnaRequest('/status', { attempts: 1 });

    const [url, opts] = fetchMock.mock.calls[0];

    expect(url).toBe('https://api.telna.test/status');
    expect(opts.method).toBe('GET');
    expect(opts.headers).toEqual({
      Authorization: 'Bearer test-api-key',
      'Content-Type': 'application/json',
    });
    expect(opts.body).toBeUndefined();
    expect(opts.signal).toBeDefined();

    expect(result).toEqual({ hello: 'world' });
  });

  it('returns empty object when successful response body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValueOnce('not json'),
    });

    const result = await telnaRequest('/plain', { attempts: 1 });

    expect(result).toEqual({});
  });

  it('throws a descriptive error when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: jest.fn().mockResolvedValueOnce('boom'),
    });

    await expect(
      telnaRequest('/error', { method: 'GET', attempts: 1 })
    ).rejects.toThrow(
      '[TELNA] GET https://api.telna.test/error failed: 500 Server Error — boom'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});