// server/services/__tests__/forwardingService.test.js
import { jest } from '@jest/globals';

// ---- Shared prisma mock ----
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

// ---- Mock prismaClient BEFORE importing the service ----
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// ---- Import functions under test ----
const {
  getForwardingPrefs,
  updateForwardingPrefs,
} = await import('../forwardingService.js');

describe('forwardingService.getForwardingPrefs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns forwarding prefs when user exists', async () => {
    const prefs = {
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardPhoneNumber: '+15551234567',
      forwardSmsToEmail: true,
      forwardEmail: 'user@example.com',
      forwardingEnabledCalls: false,
      forwardToPhoneE164: '',
      forwardQuietHoursStart: 22,
      forwardQuietHoursEnd: 7,
    };

    mockPrisma.user.findUnique.mockResolvedValue(prefs);

    const result = await getForwardingPrefs('5');

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: {
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardPhoneNumber: true,
        forwardSmsToEmail: true,
        forwardEmail: true,
        forwardingEnabledCalls: true,
        forwardToPhoneE164: true,
        forwardQuietHoursStart: true,
        forwardQuietHoursEnd: true,
      },
    });
    expect(result).toBe(prefs);
  });

  it('throws Boom 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(getForwardingPrefs(123)).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 404 },
      message: 'User not found',
    });
  });
});

describe('forwardingService.updateForwardingPrefs', () => {
  const basePrefs = {
    forwardingEnabledSms: false,
    forwardSmsToPhone: false,
    forwardPhoneNumber: '',
    forwardSmsToEmail: false,
    forwardEmail: '',
    forwardingEnabledCalls: false,
    forwardToPhoneE164: '',
    forwardQuietHoursStart: null,
    forwardQuietHoursEnd: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates prefs successfully with valid phone/email and quiet hours', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(basePrefs);

    const updatedPrefs = {
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardPhoneNumber: '+15551234567',
      forwardSmsToEmail: true,
      forwardEmail: 'user@example.com',
      forwardingEnabledCalls: true,
      forwardToPhoneE164: '+19998887777',
      forwardQuietHoursStart: 22,
      forwardQuietHoursEnd: 7,
    };

    mockPrisma.user.update.mockResolvedValue(updatedPrefs);

    const result = await updateForwardingPrefs(1, {
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardPhoneNumber: '+1 (555) 123-4567', // should be normalized
      forwardSmsToEmail: true,
      forwardEmail: 'user@example.com',
      forwardingEnabledCalls: true,
      forwardToPhoneE164: '+1-999-888-7777', // should be normalized
      forwardQuietHoursStart: 22,
      forwardQuietHoursEnd: 7,
    });

    // It should call getForwardingPrefs several times; we don't assert call count, just that update is correct.
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardPhoneNumber: '+15551234567',
        forwardSmsToEmail: true,
        forwardEmail: 'user@example.com',
        forwardingEnabledCalls: true,
        forwardToPhoneE164: '+19998887777',
        forwardQuietHoursStart: 22,
        forwardQuietHoursEnd: 7,
      },
      select: {
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardPhoneNumber: true,
        forwardSmsToEmail: true,
        forwardEmail: true,
        forwardingEnabledCalls: true,
        forwardToPhoneE164: true,
        forwardQuietHoursStart: true,
        forwardQuietHoursEnd: true,
      },
    });

    expect(result).toBe(updatedPrefs);
  });

  it('throws when enabling SMS forwarding with no destinations', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(basePrefs);

    await expect(
      updateForwardingPrefs(1, {
        forwardingEnabledSms: true,
        forwardSmsToPhone: false,
        forwardSmsToEmail: false,
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
      message: 'Enable at least one SMS destination (phone or email).',
    });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('throws when SMS forwarding to phone but phone number is missing/invalid', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(basePrefs);

    await expect(
      updateForwardingPrefs(1, {
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardPhoneNumber: 'not-a-phone',
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
      message: 'Missing/invalid forwardPhoneNumber',
    });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('throws when SMS forwarding to email but email is invalid', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(basePrefs);

    await expect(
      updateForwardingPrefs(1, {
        forwardingEnabledSms: true,
        forwardSmsToEmail: true,
        forwardEmail: 'not-an-email',
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
      // first invalid email check happens in forwardEmail block
      message: 'Invalid email for SMS forwarding',
    });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('throws when enabling call forwarding with invalid phone', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(basePrefs);

    await expect(
      updateForwardingPrefs(1, {
        forwardingEnabledCalls: true,
        forwardToPhoneE164: 'abc',
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
      message: 'Invalid phone for call forwarding',
    });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('throws when quiet hours are out of range', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(basePrefs);

    await expect(
      updateForwardingPrefs(1, {
        forwardQuietHoursStart: 25,
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
      message: 'Quiet hours must be 0–23 or null',
    });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('throws when final validation detects missing forwardToPhoneE164 while calls enabled', async () => {
    // Base prefs already have forwardingEnabledCalls true but no number
    const base = {
      ...basePrefs,
      forwardingEnabledCalls: true,
      forwardToPhoneE164: '',
    };
    mockPrisma.user.findUnique.mockResolvedValue(base);

    await expect(
      updateForwardingPrefs(1, {
        // not touching forwardToPhoneE164 here; final check should fail
      }),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
      message: 'Missing/invalid forwardToPhoneE164',
    });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
