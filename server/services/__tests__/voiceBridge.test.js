import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// --- Env setup (captured at module load in voiceBridge) ----------------------

process.env.TWILIO_ACCOUNT_SID = 'AC_TEST_SID';
process.env.TWILIO_AUTH_TOKEN = 'TEST_AUTH_TOKEN';
process.env.APP_API_ORIGIN = 'https://api.example.com';
process.env.TWILIO_VOICE_WEBHOOK_URL = ''; // so APP_API_ORIGIN is used
process.env.TWILIO_VOICE_STATUS_CALLBACK_URL =
  'https://status.example.com/twilio';

// --- Prisma mock -------------------------------------------------------------

const mockUserFindUnique = jest.fn();

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockUserFindUnique,
    },
  },
}));

// --- Phone utils mock --------------------------------------------------------

jest.unstable_mockModule('../utils/phone.js', () => ({
  __esModule: true,
  normalizeE164: (v) => String(v || ''),
  isE164: (v) => String(v || '').startsWith('+'),
}));

// --- Twilio mock -------------------------------------------------------------

const mockCallsCreate = jest.fn();
const mockTwilioCtor = jest.fn(() => ({
  calls: {
    create: mockCallsCreate,
  },
}));

jest.unstable_mockModule('twilio', () => ({
  __esModule: true,
  default: mockTwilioCtor,
}));

// Import service AFTER mocks & env
const { startAliasCall } = await import('../voiceBridge.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockReset();
  mockCallsCreate.mockReset();
});

// --- Tests -------------------------------------------------------------------

describe('startAliasCall', () => {
  it('throws 400 Bad Request for invalid destination phone', async () => {
    await expect(
      startAliasCall({ userId: 1, to: 'not-a-phone' })
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
      message: 'Invalid destination phone',
    });

    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockTwilioCtor).not.toHaveBeenCalled();
  });

  it('throws 412 when user has no assigned Chatforia number', async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: 1,
      assignedNumbers: [],
      forwardingEnabledCalls: true,
      forwardToPhoneE164: '+15550001111',
    });

    await expect(
      startAliasCall({ userId: 1, to: '+15550002222' })
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 412 },
      message: 'No Chatforia number assigned',
    });

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        assignedNumbers: {
          select: { e164: true },
          take: 1,
          orderBy: { id: 'asc' },
        },
        forwardingEnabledCalls: true,
        forwardToPhoneE164: true,
      },
    });

    expect(mockTwilioCtor).not.toHaveBeenCalled();
  });

  it('throws 412 when user forwarding phone is not verified / invalid', async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: 2,
      assignedNumbers: [{ e164: '+15550003333' }],
      forwardingEnabledCalls: true,
      forwardToPhoneE164: '5551234',
    });

    await expect(
      startAliasCall({ userId: 2, to: '+15550004444' })
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 412 },
      message: 'User call forwarding phone not verified',
    });

    expect(mockUserFindUnique).toHaveBeenCalledTimes(1);
    expect(mockTwilioCtor).not.toHaveBeenCalled();
  });

  it('throws 412 when call forwarding is not enabled', async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: 3,
      assignedNumbers: [{ e164: '+15550003333' }],
      forwardingEnabledCalls: false,
      forwardToPhoneE164: '+15550001111',
    });

    await expect(
      startAliasCall({ userId: 3, to: '+15550004444' })
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 412 },
      message: 'Call forwarding is not enabled',
    });

    expect(mockUserFindUnique).toHaveBeenCalledTimes(1);
    expect(mockTwilioCtor).not.toHaveBeenCalled();
  });

  it('creates Twilio call for leg A and returns call metadata on success', async () => {
    const userId = 10;
    const fromNumber = '+15550009999';
    const userPhone = '+15550008888';
    const dest = '+15550007777';

    mockUserFindUnique.mockResolvedValueOnce({
      id: userId,
      assignedNumbers: [{ e164: fromNumber }],
      forwardingEnabledCalls: true,
      forwardToPhoneE164: userPhone,
    });

    mockCallsCreate.mockResolvedValueOnce({ sid: 'CA1234567890' });

    const result = await startAliasCall({ userId, to: dest });

    expect(result).toEqual({
      ok: true,
      from: fromNumber,
      to: dest,
      userPhone,
      stage: 'legA-dialing',
      callSid: 'CA1234567890',
    });

    expect(mockTwilioCtor).toHaveBeenCalledWith(
      'AC_TEST_SID',
      'TEST_AUTH_TOKEN'
    );

    expect(mockCallsCreate).toHaveBeenCalledTimes(1);
    const args = mockCallsCreate.mock.calls[0][0];

    expect(args.to).toBe(userPhone);
    expect(args.from).toBe(fromNumber);

    const legAUrl = new URL(args.url);
    expect(legAUrl.origin).toBe('https://api.example.com');
    expect(legAUrl.pathname).toBe('/webhooks/voice/alias/legA');
    expect(legAUrl.searchParams.get('userId')).toBe(String(userId));
    expect(legAUrl.searchParams.get('from')).toBe(fromNumber);
    expect(legAUrl.searchParams.get('to')).toBe(dest);

    expect(args.machineDetection).toBe('Enable');
    expect(args.statusCallback).toBe('https://status.example.com/twilio');
    expect(args.statusCallbackEvent).toEqual([
      'initiated',
      'ringing',
      'answered',
      'completed',
    ]);
    expect(args.statusCallbackMethod).toBe('POST');
  });
});