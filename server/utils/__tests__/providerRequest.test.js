jest.useFakeTimers();

jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');

const {
  providerRequest,
  makeProviderClient,
} = require('../providerRequest.js');

describe('providerRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to create a mocked Response-like object
  function mockResponse({
    ok = true,
    status = 200,
    statusText = 'OK',
    jsonBody = null,
    textBody = null,
    contentType = 'application/json',
  } = {}) {
    const headers = {
      get: jest.fn().mockImplementation((k) => {
        if (k.toLowerCase() === 'content-type') return contentType;
        return null;
      }),
    };

    const json = jest.fn().mockImplementation(() => {
      if (jsonBody instanceof Error) return Promise.reject(jsonBody);
      return Promise.resolve(jsonBody);
    });

    const text = jest.fn().mockImplementation(() => {
      if (textBody instanceof Error) return Promise.reject(textBody);
      // If jsonBody is provided but textBody is not, return JSON stringified
      if (textBody == null && jsonBody != null) return Promise.resolve(JSON.stringify(jsonBody));
      return Promise.resolve(textBody);
    });

    return Promise.resolve({
      ok,
      status,
      statusText,
      headers,
      json,
      text,
    });
  }

  it('throws when baseUrl is missing', async () => {
    await expect(
      providerRequest({ baseUrl: undefined, path: '/x' })
    ).rejects.toHaveProperty('code', 'MISSING_BASE_URL');
  });

  it('builds URL from baseUrl + path and parses JSON responses', async () => {
    fetch.mockResolvedValueOnce(
      await mockResponse({ jsonBody: { a: 1 }, textBody: '{"a":1}' })
    );

    const res = await providerRequest({ baseUrl: 'https://api.test/', path: '/hello' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [urlCalled] = fetch.mock.calls[0];
    expect(urlCalled).toBe('https://api.test/hello');
    expect(res).toEqual({ a: 1 });
  });

  it('accepts absolute path (full URL) and returns text when content-type is not JSON', async () => {
    fetch.mockResolvedValueOnce(
      await mockResponse({ jsonBody: null, textBody: 'plain text', contentType: 'text/plain' })
    );

    const absolute = 'https://other.example.com/endpoint';
    const res = await providerRequest({ baseUrl: 'https://api.test/', path: absolute });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(absolute);
    expect(res).toBe('plain text');
  });

  it('sends JSON body and sets content-type header when object body provided', async () => {
    fetch.mockResolvedValueOnce(
      await mockResponse({ jsonBody: { ok: true } })
    );

    await providerRequest({
      baseUrl: 'https://api.test/',
      path: '/post',
      method: 'POST',
      body: { x: 1 },
      headers: { 'x-custom': 'v' },
      apiKey: 'SOMEKEY',
    });

    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers.Authorization).toBe('Bearer SOMEKEY');
    // body should be JSON string
    expect(opts.body).toBe(JSON.stringify({ x: 1 }));
  });

  it('prefers explicit Authorization header over apiKey', async () => {
    fetch.mockResolvedValueOnce(
      await mockResponse({ jsonBody: { ok: true } })
    );

    await providerRequest({
      baseUrl: 'https://api.test/',
      path: '/post',
      method: 'POST',
      apiKey: 'SOMEKEY',
      headers: { Authorization: 'Token EXPLICIT' },
    });

    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Token EXPLICIT');
  });

  it('sets Basic auth header when auth provided and no Authorization present', async () => {
    fetch.mockResolvedValueOnce(
      await mockResponse({ jsonBody: { ok: true } })
    );

    await providerRequest({
      baseUrl: 'https://api.test/',
      path: '/post',
      auth: { user: 'bob', pass: 'secret' },
    });

    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers.Authorization).toMatch(/^Basic\s+/);
    // Basic should decode to bob:secret
    const b64 = opts.headers.Authorization.split(/\s+/)[1];
    expect(Buffer.from(b64, 'base64').toString()).toBe('bob:secret');
  });

  it('parses malformed JSON by falling back to text', async () => {
    // content-type application/json but json() rejects -> fallback to text
    const jsonErr = new Error('bad json');
    fetch.mockResolvedValueOnce(
      await mockResponse({ jsonBody: jsonErr, textBody: 'not-json', contentType: 'application/json' })
    );

    const res = await providerRequest({ baseUrl: 'https://api.test/', path: '/badjson' });
    // parseResponseBody will fall back to text result
    expect(res).toBe('not-json');
  });

  it('throws ProviderRequestError on 4xx and includes providerBody', async () => {
    fetch.mockResolvedValueOnce(
      await mockResponse({ ok: false, status: 400, statusText: 'Bad Request', textBody: 'oops', contentType: 'text/plain' })
    );

    await expect(
      providerRequest({ baseUrl: 'https://api.test/', path: '/bad', provider: 'plintron' })
    ).rejects.toMatchObject({
      status: 400,
      statusText: 'Bad Request',
      providerBody: 'oops',
      code: 'HTTP_400',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and succeeds within attempts', async () => {
    // first response 500, second success
    fetch
      .mockResolvedValueOnce(await mockResponse({ ok: false, status: 500, statusText: 'Server' , textBody: 'server' }))
      .mockResolvedValueOnce(await mockResponse({ jsonBody: { ok: true } }));

    const p = providerRequest({ baseUrl: 'https://api.test/', path: '/retry', attempts: 2 });

    // Advance timers to allow backoff sleep to run
    await jest.runAllTimersAsync();

    const res = await p;
    expect(res).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails after max retries on 5xx', async () => {
    fetch.mockResolvedValue(await mockResponse({ ok: false, status: 502, statusText: 'Bad Gateway' }));

    const p = providerRequest({ baseUrl: 'https://api.test/', path: '/down', attempts: 3 });

    await jest.runAllTimersAsync();

    await expect(p).rejects.toHaveProperty('status', 502);
    // should have attempted 3 times
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network errors and eventually succeeds', async () => {
    const netErr = new Error('ECONNRESET');
    // Simulate fetch throwing network error first, then success
    fetch
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce(await mockResponse({ jsonBody: { ok: true } }));

    const p = providerRequest({ baseUrl: 'https://api.test/', path: '/net', attempts: 2 });

    await jest.runAllTimersAsync();

    const res = await p;
    expect(res).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('on AbortError shapes a REQUEST_ABORTED error and stops retrying when attempts exhausted', async () => {
    // Simulate fetch rejecting with AbortError
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';

    fetch
      .mockRejectedValueOnce(abortErr);

    const p = providerRequest({ baseUrl: 'https://api.test/', path: '/abort', attempts: 1, timeout: 1 });

    // advance timers so internal timeout triggers (the implementation uses setTimeout + AbortController)
    await jest.runAllTimersAsync();

    await expect(p).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });

  it('makeProviderClient merges defaults and calls providerRequest', async () => {
    fetch.mockResolvedValueOnce(
      await mockResponse({ jsonBody: { ok: true } })
    );

    const client = makeProviderClient({
      baseUrl: 'https://api.test/',
      apiKey: 'CLIENTKEY',
      provider: 'myprov',
      defaultHeaders: { 'x-default': '1' },
      timeout: 5000,
      attempts: 2,
    });

    const res = await client('/foo', { method: 'POST', body: { y: 2 }, headers: { 'x-c': 'v' } });

    expect(res).toEqual({ ok: true });
    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers['x-default']).toBe('1');
    expect(opts.headers['x-c']).toBe('v');
    expect(opts.headers.Authorization).toBe('Bearer CLIENTKEY');
  });
});