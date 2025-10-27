import { jest } from '@jest/globals';

// ---- Mock normalizeE164 so we can assert transform() is applied ----
// We mock BEFORE importing validators.js, because validators.js imports normalizeE164 at module load.
jest.unstable_mockModule('./phone.js', () => ({
  // Fake normalizeE164. We'll treat any non-empty string as "valid"
  // and map it to a predictable E.164 string. Otherwise return '' so
  // the refine(Boolean, 'Invalid phone') fails.
  normalizeE164: (input) => {
    if (!input || typeof input !== 'string') return '';
    return '+19995551234';
  },
}));

// Now import the schemas under test (must be dynamic import after mock).
let SmsInviteSchema;
let EmailInviteSchema;

beforeAll(async () => {
  const m = await import('../../utils/validators.js');
  SmsInviteSchema = m.SmsInviteSchema;
  EmailInviteSchema = m.EmailInviteSchema;
});

describe('SmsInviteSchema', () => {
  test('accepts valid phone and normalizes it', () => {
    const input = {
      phone: '999-555-1234',
      message: 'hey join my chat',
      preferredProvider: 'telnyx',
    };

    const parsed = SmsInviteSchema.parse(input);

    // phone got run through normalizeE164 mock
    expect(parsed.phone).toBe('+19995551234');

    // message is optional but when provided it should round-trip
    expect(parsed.message).toBe('hey join my chat');

    // enum should allow "telnyx"
    expect(parsed.preferredProvider).toBe('telnyx');
  });

  test('rejects invalid preferredProvider', () => {
    const bad = {
      phone: '999-555-1234',
      preferredProvider: 'twilio', // not allowed in enum
    };

    expect(() => SmsInviteSchema.parse(bad)).toThrow(
      /Invalid enum value|invalid_enum_value/i
    );
  });

  test('rejects if normalizeE164 returns falsy (invalid phone)', () => {
    // Our mock normalizeE164 returns '' when input is falsy/garbage.
    const bad = {
      phone: '', // empty
    };

    expect(() => SmsInviteSchema.parse(bad)).toThrow(/Invalid phone/i);
  });

  test('rejects message longer than 480 chars', () => {
    const longMessage = 'x'.repeat(481);

    const tooLong = {
      phone: '999-555-1234',
      message: longMessage,
    };

    expect(() => SmsInviteSchema.parse(tooLong)).toThrow(
      /String must contain at most 480 character/i
    );
  });

  test('allows missing optional fields', () => {
    const minimal = {
      phone: '555',
    };

    // mock normalizes anyway
    const parsed = SmsInviteSchema.parse(minimal);
    expect(parsed.phone).toBe('+19995551234');
    // message and preferredProvider should be undefined
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
