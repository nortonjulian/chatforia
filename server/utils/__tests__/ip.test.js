import {
  describe,
  test,
  expect,
} from '@jest/globals';

const { getClientIp } = await import('../../utils/ip.js');

describe('getClientIp', () => {
  test('returns first IP from x-forwarded-for (single value string)', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.1' },
      ip: '10.0.0.1',
    };

    const ip = getClientIp(req);
    expect(ip).toBe('203.0.113.1');
  });

  test('returns first IP from x-forwarded-for (multiple comma-separated)', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178' },
      ip: '10.0.0.2',
    };

    const ip = getClientIp(req);
    expect(ip).toBe('203.0.113.5');
  });

  test('handles x-forwarded-for as array and uses its first element', () => {
    const req = {
      headers: { 'x-forwarded-for': ['198.51.100.10', '198.51.100.11'] },
      ip: '10.0.0.3',
    };

    const ip = getClientIp(req);
    expect(ip).toBe('198.51.100.10');
  });

  test('falls back to req.ip when x-forwarded-for is missing', () => {
    const req = {
      headers: {},
      ip: '192.0.2.123',
    };

    const ip = getClientIp(req);
    expect(ip).toBe('192.0.2.123');
  });

  test('falls back to req.ip when x-forwarded-for is empty string', () => {
    const req = {
      headers: { 'x-forwarded-for': '' },
      ip: '192.0.2.200',
    };

    const ip = getClientIp(req);
    expect(ip).toBe('192.0.2.200');
  });

  test('returns empty string when neither x-forwarded-for nor req.ip provide a value', () => {
    const req = {
      headers: {},
      ip: '',
    };

    const ip = getClientIp(req);
    expect(ip).toBe('');
  });

  test('trims whitespace around IPs in x-forwarded-for', () => {
    const req = {
      headers: { 'x-forwarded-for': '   203.0.113.9   , 10.0.0.4' },
      ip: '10.0.0.99',
    };

    const ip = getClientIp(req);
    expect(ip).toBe('203.0.113.9');
  });
});
