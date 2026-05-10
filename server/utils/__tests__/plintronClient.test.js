/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

jest.useFakeTimers();

const fetchMock = jest.fn();

let plintronConfig = {
  baseUrl: 'https://plintron.test/',
  apiKey: 'APIKEY',
};

await jest.unstable_mockModule('node-fetch', () => ({
  __esModule: true,
  default: fetchMock,
}));

await jest.unstable_mockModule('../config/esim.js', () => ({
  __esModule: true,
  get PLINTRON() {
    return plintronConfig;
  },
  getEsimProviderConfig: jest.fn(() => plintronConfig),
}));

const { plintronRequest } = await import('../plintronClient.js');

function mockResponse({
  ok = true,
  status = 200,
  statusText = 'OK',
  body = '{}',
} = {}) {
  return {
    ok,
    status,
    statusText,
    text: jest.fn().mockResolvedValue(body),
  };
}

describe('plintronRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();

    plintronConfig = {
      baseUrl: 'https://plintron.test/',
      apiKey: 'APIKEY',
    };
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('performs GET request and parses JSON', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: '{"a":1}' }));

    const result = await plintronRequest('/hello', { attempts: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ a: 1 });
  });

  it('sends POST body and auth header', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: '{"ok":true}' }));

    await plintronRequest('/post', {
      method: 'POST',
      body: { x: 1 },
      attempts: 1,
    });

    const [url, opts] = fetchMock.mock.calls[0];

    expect(url).toBe('https://plintron.test/post');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer APIKEY');
    expect(opts.body).toBe(JSON.stringify({ x: 1 }));
    expect(opts.signal).toBeDefined();
  });

  it('returns empty object for invalid JSON', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: 'not-json' }));

    const res = await plintronRequest('/invalid', { attempts: 1 });

    expect(res).toEqual({});
  });

  it('throws formatted error for 4xx', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        body: 'bad data',
      })
    );

    await expect(
      plintronRequest('/bad', { attempts: 1 })
    ).rejects.toThrow(
      '[PLINTRON] GET https://plintron.test/bad failed: 400 Bad Request'
    );
  });

  it('retries on 5xx then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Server',
        })
      )
      .mockResolvedValueOnce(mockResponse({ body: '{"ok":true}' }));

    const promise = plintronRequest('/retry', { attempts: 2 });

    await jest.runAllTimersAsync();

    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it('fails after max retries on 5xx', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 500,
        statusText: 'Server',
      })
    );

    const promise = plintronRequest('/retry', { attempts: 3 });
    const assertion = expect(promise).rejects.toHaveProperty('status', 500);

    await jest.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries ECONNRESET', async () => {
    const err = new Error('boom');
    err.code = 'ECONNRESET';

    fetchMock
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(mockResponse({ body: '{"ok":true}' }));

    const promise = plintronRequest('/net', { attempts: 2 });

    await jest.runAllTimersAsync();

    const res = await promise;

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws PLINTRON_TIMEOUT on abort', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';

    fetchMock.mockRejectedValueOnce(abortErr);

    const promise = plintronRequest('/timeout', {
      timeout: 10,
      attempts: 1,
    });

    const assertion = expect(promise).rejects.toHaveProperty(
      'code',
      'PLINTRON_TIMEOUT'
    );

    await jest.runAllTimersAsync();
    await assertion;
  });

  it('handles leading slash correctly', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: '{"ok":true}' }));

    await plintronRequest('no-slash', { attempts: 1 });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://plintron.test/no-slash'
    );
  });
});