jest.useFakeTimers();

// ---- Mocks ----
jest.mock('node-fetch', () => jest.fn());
jest.mock('../config/esim.js', () => {
  let config = { baseUrl: 'https://plintron.test/', apiKey: 'APIKEY' };
  return {
    get PLINTRON() {
      return config;
    },
    __setPlintron: (val) => (config = val),
  };
});

const fetch = require('node-fetch');
const { __setPlintron } = require('../config/esim.js');
const { plintronRequest } = require('../plintronClient.js');

function mockResponse({ ok = true, status = 200, statusText = 'OK', body = '{}' }) {
  return Promise.resolve({
    ok,
    status,
    statusText,
    text: jest.fn().mockResolvedValue(body),
  });
}

describe('plintronRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __setPlintron({ baseUrl: 'https://plintron.test/', apiKey: 'APIKEY' });
  });

  // --------------------------------------------------
  // CONFIG
  // --------------------------------------------------
  it('throws if baseUrl missing', async () => {
    __setPlintron({});

    await expect(plintronRequest('/x')).rejects.toThrow('PLINTRON.baseUrl is not configured');
  });

  // --------------------------------------------------
  // SUCCESS PATH
  // --------------------------------------------------
  it('performs GET request and parses JSON', async () => {
    fetch.mockResolvedValueOnce(await mockResponse({ body: '{"a":1}' }));

    const result = await plintronRequest('/hello');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ a: 1 });
  });

  it('sends POST body and auth header', async () => {
    fetch.mockResolvedValueOnce(await mockResponse({ body: '{"ok":true}' }));

    await plintronRequest('/post', { method: 'POST', body: { x: 1 } });

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://plintron.test/post');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer APIKEY');
    expect(opts.body).toBe(JSON.stringify({ x: 1 }));
  });

  it('returns empty object for invalid JSON', async () => {
    fetch.mockResolvedValueOnce(await mockResponse({ body: 'not-json' }));

    const res = await plintronRequest('/invalid');
    expect(res).toEqual({});
  });

  // --------------------------------------------------
  // HTTP ERRORS
  // --------------------------------------------------
  it('throws formatted error for 4xx', async () => {
    fetch.mockResolvedValueOnce(
      await mockResponse({ ok: false, status: 400, statusText: 'Bad Request', body: 'bad data' })
    );

    await expect(plintronRequest('/bad')).rejects.toThrow('[PLINTRON] GET https://plintron.test/bad failed: 400 Bad Request');
  });

  it('retries on 5xx then succeeds', async () => {
    fetch
      .mockResolvedValueOnce(await mockResponse({ ok: false, status: 500, statusText: 'Server' }))
      .mockResolvedValueOnce(await mockResponse({ body: '{"ok":true}' }));

    const promise = plintronRequest('/retry', { attempts: 2 });

    // advance retry backoff timer
    await jest.runAllTimersAsync();

    const result = await promise;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it('fails after max retries on 5xx', async () => {
    fetch.mockResolvedValue(await mockResponse({ ok: false, status: 500, statusText: 'Server' }));

    const promise = plintronRequest('/retry', { attempts: 3 });

    await jest.runAllTimersAsync();

    await expect(promise).rejects.toHaveProperty('status', 500);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  // --------------------------------------------------
  // NETWORK ERRORS
  // --------------------------------------------------
  it('retries ECONNRESET', async () => {
    const err = new Error('boom');
    err.code = 'ECONNRESET';

    fetch
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(await mockResponse({ body: '{"ok":true}' }));

    const promise = plintronRequest('/net', { attempts: 2 });
    await jest.runAllTimersAsync();

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // --------------------------------------------------
  // TIMEOUT
  // --------------------------------------------------
  it('throws PLINTRON_TIMEOUT on abort', async () => {
    fetch.mockImplementation(() => {
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 50);
      });
    });

    const promise = plintronRequest('/timeout', { timeout: 10, attempts: 1 });

    await jest.advanceTimersByTimeAsync(50);

    await expect(promise).rejects.toHaveProperty('code', 'PLINTRON_TIMEOUT');
  });

  // --------------------------------------------------
  // URL JOINING
  // --------------------------------------------------
  it('handles leading slash correctly', async () => {
    fetch.mockResolvedValueOnce(await mockResponse({ body: '{"ok":true}' }));

    await plintronRequest('no-slash');

    expect(fetch.mock.calls[0][0]).toBe('https://plintron.test/no-slash');
  });
});