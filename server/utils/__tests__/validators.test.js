/**
 * server/utils/__tests__/validators.test.js
 *
 * We test the real Zod schemas in utils/validators.js with the real
 * normalizeE164() from utils/phone.js.
 *
 * No mocking.
 */

import {
  SmsInviteSchema,
  EmailInviteSchema,
} from '../../utils/validators.js';

describe('SmsInviteSchema (integration with real normalizeE164)', () => {
  test('accepts valid phone and normalizes it', () => {
    const input = {
      phone: '415-555-2671', // US 10-digit, will normalize to +14155552671
      message: 'hey join my chat',
      preferredProvider: 'telnyx',
    };

    const parsed = SmsInviteSchema.parse(input);

    // normalizeE164 should have turned this into +1E164 form
    expect(parsed.phone).toBe('+14155552671');

    // message should round-trip
    expect(parsed.message).toBe('hey join my chat');

    // enum value should be allowed
    expect(parsed.preferredProvider).toBe('telnyx');
  });

  test('rejects invalid preferredProvider', () => {
    const bad = {
      phone: '4155552671', // still valid as US
      preferredProvider: 'twilio', // not in the enum
    };

    expect(() => SmsInviteSchema.parse(bad)).toThrow(
      /Invalid enum value|invalid_enum_value/i
    );
  });

  test('rejects if normalizeE164 returns falsy (invalid phone)', () => {
  // Use a string that:
  //  - is at least 3 chars (so .min(3) passes),
  //  - but still cannot be normalized to valid E.164.
  //
  // "123" is too short to become a valid US E.164 in our normalizeE164/toE164 logic,
  // so normalizeE164('123') => null, then refine(Boolean, 'Invalid phone') should fire.
  const bad = {
    phone: '123',
  };

  expect(() => SmsInviteSchema.parse(bad)).toThrow(/Invalid phone/i);
});


  test('rejects message longer than 480 chars', () => {
    const longMessage = 'x'.repeat(481);

    const tooLong = {
      phone: '4155552671',
      message: longMessage,
    };

    expect(() => SmsInviteSchema.parse(tooLong)).toThrow(
      /String must contain at most 480 character/i
    );
  });

  test('allows missing optional fields', () => {
    const minimal = {
      phone: '4155552671',
    };

    const parsed = SmsInviteSchema.parse(minimal);

    expect(parsed.phone).toBe('+14155552671');
    expect(parsed.message).toBeUndefined();
    expect(parsed.preferredProvider).toBeUndefined();
  });
});

describe('EmailInviteSchema', () => {
  test('accepts a single valid email string', () => {
    const input = {
      to: 'user@example.com',
      roomId: 'abc123',
      subject: 'Welcome',
      html: '<b>hi</b>',
      text: 'hi',
    };

    const parsed = EmailInviteSchema.parse(input);

    expect(parsed.to).toBe('user@example.com');
    expect(parsed.roomId).toBe('abc123');
    expect(parsed.subject).toBe('Welcome');
    expect(parsed.html).toBe('<b>hi</b>');
    expect(parsed.text).toBe('hi');
  });

  test('accepts an array of valid emails', () => {
    const input = {
      to: ['a@example.com', 'b@example.com'],
    };

    const parsed = EmailInviteSchema.parse(input);

    expect(Array.isArray(parsed.to)).toBe(true);
    expect(parsed.to).toEqual(['a@example.com', 'b@example.com']);
  });

  test('rejects invalid email', () => {
    const bad = {
      to: 'not-an-email',
    };

    expect(() => EmailInviteSchema.parse(bad)).toThrow(/Invalid email/i);
  });

  test('rejects empty array for "to"', () => {
    const bad = {
      to: [],
    };

    expect(() => EmailInviteSchema.parse(bad)).toThrow(
      /Array must contain at least 1 element/i
    );
  });

  test('rejects subject > 120 chars', () => {
    const longSubj = 's'.repeat(121);

    const bad = {
      to: 'user@example.com',
      subject: longSubj,
    };

    expect(() => EmailInviteSchema.parse(bad)).toThrow(
      /String must contain at most 120 character/i
    );
  });

  test('allows optional fields to be omitted', () => {
    const minimal = {
      to: 'user@example.com',
    };

    const parsed = EmailInviteSchema.parse(minimal);

    expect(parsed.to).toBe('user@example.com');
    expect(parsed.roomId).toBeUndefined();
    expect(parsed.subject).toBeUndefined();
    expect(parsed.html).toBeUndefined();
    expect(parsed.text).toBeUndefined();
  });

  test('roomId can be number or string', () => {
    const numeric = {
      to: 'user@example.com',
      roomId: 42,
    };

    const parsed = EmailInviteSchema.parse(numeric);
    expect(parsed.roomId).toBe(42);

    const str = {
      to: 'user@example.com',
      roomId: 'room-123',
    };

    const parsed2 = EmailInviteSchema.parse(str);
    expect(parsed2.roomId).toBe('room-123');
  });
});
