import { inQuietHours, normalizeForwardingTimeZone } from '../forwardingQuietHours.js';

describe('shared voice and SMS quiet hours', () => {
  const at = (hour) => ({ getHours: () => hour });

  it('uses an inclusive start and exclusive end for same-day hours', () => {
    expect(inQuietHours(9, 17, at(8))).toBe(false);
    expect(inQuietHours(9, 17, at(9))).toBe(true);
    expect(inQuietHours(9, 17, at(16))).toBe(true);
    expect(inQuietHours(9, 17, at(17))).toBe(false);
  });

  it('spans midnight without suppressing the rest of the day', () => {
    expect(inQuietHours(22, 6, at(21))).toBe(false);
    expect(inQuietHours(22, 6, at(22))).toBe(true);
    expect(inQuietHours(22, 6, at(0))).toBe(true);
    expect(inQuietHours(22, 6, at(5))).toBe(true);
    expect(inQuietHours(22, 6, at(6))).toBe(false);
  });

  it('does not suppress forwarding when disabled or start equals end', () => {
    expect(inQuietHours(null, null, at(23))).toBe(false);
    expect(inQuietHours(8, 8, at(8))).toBe(false);
  });

  it('uses the local hour supplied by Date', () => {
    const sameInstantInTwoZones = new Date('2026-11-10T05:00:00.000Z');
    const denverHour = Number(new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Denver',
    }).format(sameInstantInTwoZones));
    const utcHour = sameInstantInTwoZones.getUTCHours();
    expect(inQuietHours(22, 23, at(denverHour))).toBe(true);
    expect(inQuietHours(22, 23, at(utcHour))).toBe(false);
  });

  it('shows the spring skipped hour and fall repeated hour in a named zone', () => {
    const denverHour = (instant) => Number(new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Denver',
    }).format(new Date(instant)));

    const beforeSpring = denverHour('2026-03-08T08:59:00.000Z');
    const afterSpring = denverHour('2026-03-08T09:00:00.000Z');
    expect([beforeSpring, afterSpring]).toEqual([1, 3]);
    expect(inQuietHours(1, 3, at(beforeSpring))).toBe(true);
    expect(inQuietHours(1, 3, at(afterSpring))).toBe(false);

    const beforeFall = denverHour('2026-11-01T07:59:00.000Z');
    const afterFall = denverHour('2026-11-01T08:00:00.000Z');
    expect([beforeFall, afterFall]).toEqual([1, 1]);
    expect(inQuietHours(1, 2, at(beforeFall))).toBe(true);
    expect(inQuietHours(1, 2, at(afterFall))).toBe(true);
  });

  it('evaluates the same instant in the selected zone, including an overnight boundary', () => {
    const instant = new Date('2026-11-10T05:00:00Z'); // Denver 22:00, UTC 05:00
    expect(inQuietHours(22, 6, instant, 'America/Denver')).toBe(true);
    expect(inQuietHours(22, 6, instant, 'UTC')).toBe(true);
    expect(inQuietHours(22, 23, instant, 'America/Denver')).toBe(true);
    expect(inQuietHours(22, 23, instant, 'UTC')).toBe(false);
    expect(inQuietHours(22, 6, new Date('2026-11-10T13:00:00Z'), 'America/Denver')).toBe(false);
  });

  it('uses IANA daylight-saving rules for skipped and repeated hours', () => {
    expect(inQuietHours(1, 3, new Date('2026-03-08T08:59:00Z'), 'America/Denver')).toBe(true);
    expect(inQuietHours(1, 3, new Date('2026-03-08T09:00:00Z'), 'America/Denver')).toBe(false);
    expect(inQuietHours(1, 2, new Date('2026-11-01T07:59:00Z'), 'America/Denver')).toBe(true);
    expect(inQuietHours(1, 2, new Date('2026-11-01T08:00:00Z'), 'America/Denver')).toBe(true);
  });

  it('treats midnight in the selected zone as hour zero', () => {
    expect(inQuietHours(22, 6, new Date('2026-11-10T07:00:00Z'), 'America/Denver')).toBe(true);
    expect(inQuietHours(0, 1, new Date('2026-11-10T07:00:00Z'), 'America/Denver')).toBe(true);
  });

  it('accepts canonical IANA identifiers and rejects offsets and abbreviations', () => {
    expect(normalizeForwardingTimeZone(' America/Denver ')).toBe('America/Denver');
    expect(normalizeForwardingTimeZone('UTC')).toBe('UTC');
    expect(() => normalizeForwardingTimeZone('MST')).toThrow();
    expect(() => normalizeForwardingTimeZone('+07:00')).toThrow();
  });
});
