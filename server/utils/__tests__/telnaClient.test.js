jest.mock('node-fetch', () => jest.fn());

// Mock config so we can mutate TELNA in tests
jest.mock('../config/esim.js', () => ({
  TELNA: {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.telna.test',
  },
}));

const fetch = require('node-fetch');
const { TELNA } = require('../config/esim.js');
const { telnaRequest } = require('./telnaClient.js');

describe('telnaRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TELNA.apiKey = 'test-api-key';
    TELNA.baseUrl = 'https://api.telna.test';
    delete process.env.TELNA_API_BASE;
  });

  it('throws if Telna API key is missing', async () => {
    TELNA.apiKey = null;

    await expect(telnaRequest('/esim/test')).rejects.toThrow(
      'Telna is not configured (missing API key)'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses TELNA.baseUrl when set, and sends JSON body + headers', async () => {
    const jsonMock = jest.fn().mockResolvedValue({ ok: true, foo: 'bar' });
    fetch.mockResolvedValue({
      ok: true,
      json: jsonMock,
    });

    const result = await telnaRequest('/esim/reserve', {
      method: 'POST',
      body: { a: 1, b: 'two' },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://api.telna.test/esim/reserve', {
      method: 'POST',
      headers: {
        Authorization: `Bearer test-api-key`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ a: 1, b: 'two' }),
    });

    expect(jsonMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, foo: 'bar' });
  });

  it('defaults method to GET and omits body when none provided', async () => {
    const jsonMock = jest.fn().mockResolvedValue({ hello: 'world' });
    fetch.mockResolvedValue({
      ok: true,
      json: jsonMock,
    });

    const result = await telnaRequest('/status');

    expect(fetch).toHaveBeenCalledWith('https://api.telna.test/status', {
      method: 'GET',
      headers: {
        Authorization: `Bearer test-api-key`,
        'Content-Type': 'application/json',
      },
      body: undefined,
    });

    expect(result).toEqual({ hello: 'world' });
  });

  it('uses process.env.TELNA_API_BASE when TELNA.baseUrl is not set', async () => {
    TELNA.baseUrl = undefined;
    process.env.TELNA_API_BASE = 'https://env.telna.base';

    const jsonMock = jest.fn().mockResolvedValue({ via: 'env' });
    fetch.mockResolvedValue({
      ok: true,
      json: jsonMock,
    });

    const result = await telnaRequest('/ping', { method: 'GET' });

    expect(fetch).toHaveBeenCalledWith('https://env.telna.base/ping', {
      method: 'GET',
      headers: {
        Authorization: `Bearer test-api-key`,
        'Content-Type': 'application/json',
      },
      body: undefined,
    });

    expect(result).toEqual({ via: 'env' });
  });

  it('falls back to default base URL when neither TELNA.baseUrl nor env is set', async () => {
    TELNA.baseUrl = undefined;
    delete process.env.TELNA_API_BASE;

    const jsonMock = jest.fn().mockResolvedValue({ via: 'default' });
    fetch.mockResolvedValue({
      ok: true,
      json: jsonMock,
    });

    const result = await telnaRequest('/default-base');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.telna.example.com/default-base',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer test-api-key`,
          'Content-Type': 'application/json',
        },
        body: undefined,
      }
    );

    expect(result).toEqual({ via: 'default' });
  });

  it('throws a descriptive error when response is not ok', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('boom'),
    });

    await expect(
      telnaRequest('/error', { method: 'GET' })
    ).rejects.toThrow('Telna API error 500: boom');

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
