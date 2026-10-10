import {
  buildMessageTtlOptions,
  clampMessageTtlSeconds,
} from '../messageTtl';

const RAW = [
  { value: '0', fallback: 'Off' },
  { value: String(60 * 60), fallback: '1h' },
  { value: String(24 * 60 * 60), fallback: '1d', days: 1 },
  { value: String(3 * 24 * 60 * 60), fallback: '3d', days: 3 },
  { value: String(7 * 24 * 60 * 60), fallback: '7d', days: 7 },
  { value: String(14 * 24 * 60 * 60), fallback: '14d', days: 14 },
  { value: String(30 * 24 * 60 * 60), fallback: '30d', days: 30 },
];

const t = (_key, fallback) => fallback;

describe('message TTL entitlement helpers', () => {
  test('1-day entitlement hides multi-day options', () => {
    const labels = buildMessageTtlOptions(RAW, 1, t).map((item) => item.label);
    expect(labels).toEqual(['Off', '1h', '1d']);
    expect(labels).not.toContain('30d');
  });

  test('30-day entitlement exposes all supported multi-day options', () => {
    const labels = buildMessageTtlOptions(RAW, 30, t).map((item) => item.label);
    expect(labels).toEqual(['Off', '1h', '1d', '3d', '7d', '14d', '30d']);
  });

  test('clamps values above the entitlement ceiling', () => {
    expect(clampMessageTtlSeconds(30 * 24 * 60 * 60, 1))
      .toBe(24 * 60 * 60);
    expect(clampMessageTtlSeconds(30 * 24 * 60 * 60, 30))
      .toBe(30 * 24 * 60 * 60);
  });
});
