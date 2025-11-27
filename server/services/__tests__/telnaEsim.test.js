// Mock modules BEFORE requiring the module under test
jest.mock('../../config/esim.js', () => ({
  TELNA: { apiKey: 'test-api-key', partnerId: 'partner-123' },
}));

jest.mock('../../utils/telnaClient.js', () => ({
  telnaRequest: jest.fn(),
}));

const { TELNA } = require('../../config/esim.js');
const { telnaRequest } = require('../../utils/telnaClient.js');

const {
  reserveEsimProfile,
  activateProfile,
  suspendLine,
  resumeLine,
  provisionEsimPack,
  fetchEsimUsage,
} = require('./telnaEsim.js');

describe('telnaEsim provider', () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    // reset config for each test
    TELNA.apiKey = 'test-api-key';
    TELNA.partnerId = 'partner-123';

    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('reserveEsimProfile', () => {
    it('throws if Telna is not configured (missing apiKey)', async () => {
      TELNA.apiKey = null;

      await expect(
        reserveEsimProfile({ userId: 123, region: 'US' })
      ).rejects.toThrow('Telna is not configured (missing API key)');
    });

    it('calls telnaRequest with correct payload and normalizes response', async () => {
      telnaRequest.mockResolvedValue({
        smDpPlus: 'smdp+val',
        matchingId: 'match-123',
        qrPayload: 'LPA:1$xyz',
        iccidHint: '8901',
      });

      const result = await reserveEsimProfile({ userId: 42, region: 'EU' });

      expect(telnaRequest).toHaveBeenCalledTimes(1);
      expect(telnaRequest).toHaveBeenCalledWith('/esim/reserve', {
        method: 'POST',
        body: {
          externalUserId: '42',
          region: 'EU',
        },
      });

      expect(result).toEqual({
        smdp: 'smdp+val',
        activationCode: 'match-123',
        lpaUri: 'LPA:1$xyz',
        qrPayload: 'LPA:1$xyz',
        iccid: '8901',
        iccidHint: '8901',
      });
    });

    it('allows externalUserId to be undefined when userId is missing', async () => {
      telnaRequest.mockResolvedValue({
        smdp: 'smdp-direct',
        activationCode: 'code-direct',
        lpaUri: 'lpa-direct',
        qrPayload: 'qr-direct',
        iccid: 'iccid-direct',
        iccidHint: 'iccid-hint-direct',
      });

      const result = await reserveEsimProfile({ region: 'US' });

      expect(telnaRequest).toHaveBeenCalledWith('/esim/reserve', {
        method: 'POST',
        body: {
          externalUserId: undefined,
          region: 'US',
        },
      });

      expect(result).toEqual({
        smdp: 'smdp-direct',
        activationCode: 'code-direct',
        lpaUri: 'lpa-direct',
        qrPayload: 'qr-direct',
        iccid: 'iccid-direct',
        iccidHint: 'iccid-hint-direct',
      });
    });
  });

  describe('activateProfile', () => {
    it('throws if Telna is not configured', async () => {
      TELNA.apiKey = null;

      await expect(
        activateProfile({ iccid: '123', code: 'ABC' })
      ).rejects.toThrow('Telna is not configured (missing API key)');
    });

    it('posts correct payload and returns raw data', async () => {
      telnaRequest.mockResolvedValue({ ok: true, foo: 'bar' });

      const result = await activateProfile({ iccid: '123', code: 'ABC' });

      expect(telnaRequest).toHaveBeenCalledWith('/esim/activate', {
        method: 'POST',
        body: { iccid: '123', code: 'ABC' },
      });

      expect(result).toEqual({ ok: true, foo: 'bar' });
    });
  });

  describe('suspendLine', () => {
    it('throws if Telna is not configured', async () => {
      TELNA.apiKey = null;
      await expect(
        suspendLine({ iccid: 'iccid-123' })
      ).rejects.toThrow('Telna is not configured (missing API key)');
    });

    it('calls telnaRequest with encoded ICCID and POST method', async () => {
      telnaRequest.mockResolvedValue({ ok: true });

      const iccid = 'ic cid/with spaces';
      const result = await suspendLine({ iccid });

      expect(telnaRequest).toHaveBeenCalledWith(
        `/esim/${encodeURIComponent(iccid)}/suspend`,
        { method: 'POST' }
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe('resumeLine', () => {
    it('throws if Telna is not configured', async () => {
      TELNA.apiKey = null;
      await expect(
        resumeLine({ iccid: 'iccid-123' })
      ).rejects.toThrow('Telna is not configured (missing API key)');
    });

    it('calls telnaRequest with encoded ICCID and POST method', async () => {
      telnaRequest.mockResolvedValue({ ok: true });

      const iccid = 'ic cid/with spaces';
      const result = await resumeLine({ iccid });

      expect(telnaRequest).toHaveBeenCalledWith(
        `/esim/${encodeURIComponent(iccid)}/resume`,
        { method: 'POST' }
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe('provisionEsimPack', () => {
    it('returns stub and warns when Telna is not configured', async () => {
      TELNA.apiKey = null;

      const result = await provisionEsimPack({
        userId: 1,
        addonKind: 'DATA_PACK',
        planCode: 'US-5GB',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[telnaEsim] provisionEsimPack called but Telna is not configured. Returning stub.'
      );

      expect(result).toEqual({
        providerProfileId: null,
        qrCodeSvg: null,
        iccid: null,
        expiresAt: null,
        dataMb: null,
      });

      expect(telnaRequest).not.toHaveBeenCalled();
    });

    it('calls telnaRequest with correct payload and maps response (profileId + dataMb)', async () => {
      telnaRequest.mockResolvedValue({
        profileId: 'profile-123',
        qrCodeSvg: '<svg>qr</svg>',
        iccid: '8901',
        expiresAt: '2025-01-01T00:00:00.000Z',
        dataMb: 1024,
      });

      const result = await provisionEsimPack({
        userId: 7,
        addonKind: 'DATA_PACK',
        planCode: 'US-10GB',
      });

      expect(telnaRequest).toHaveBeenCalledWith('/esim/provision', {
        method: 'POST',
        body: {
          externalUserId: '7',
          addonKind: 'DATA_PACK',
          planCode: 'US-10GB',
          partnerId: 'partner-123',
        },
      });

      expect(result.providerProfileId).toBe('profile-123');
      expect(result.qrCodeSvg).toBe('<svg>qr</svg>');
      expect(result.iccid).toBe('8901');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(result.dataMb).toBe(1024);
    });

    it('falls back to id and totalMb when dataMb is missing', async () =>
    {
      telnaRequest.mockResolvedValue({
        id: 'fallback-id',
        iccid: 'iccid-xyz',
        totalMb: 2048,
        expiresAt: '2025-02-02T12:00:00.000Z',
      });

      const result = await provisionEsimPack({
        userId: 9,
        addonKind: 'ESIM_PACK',
        planCode: 'GLOBAL-2GB',
      });

      expect(result).toEqual({
        providerProfileId: 'fallback-id',
        qrCodeSvg: null,
        iccid: 'iccid-xyz',
        expiresAt: new Date('2025-02-02T12:00:00.000Z'),
        dataMb: 2048,
      });
    });
  });

  describe('fetchEsimUsage', () => {
    it('returns null-usage stub and warns when Telna is not configured', async () => {
      TELNA.apiKey = null;

      const result = await fetchEsimUsage('profile-123');

      expect(warnSpy).toHaveBeenCalledWith(
        '[telnaEsim] fetchEsimUsage called but Telna is not configured – returning null usage.'
      );

      expect(result).toEqual({
        usedMb: null,
        totalMb: null,
        remainingMb: null,
        expiresAt: null,
      });

      expect(telnaRequest).not.toHaveBeenCalled();
    });

    it('calls telnaRequest with encoded providerProfileId and maps usage directly when remainingMb present', async () => {
      telnaRequest.mockResolvedValue({
        usedMb: 500,
        totalMb: 2000,
        remainingMb: 1500,
        expiresAt: '2025-03-01T00:00:00.000Z',
      });

      const id = 'profile with spaces';
      const result = await fetchEsimUsage(id);

      expect(telnaRequest).toHaveBeenCalledWith(
        `/esim/${encodeURIComponent(id)}/usage`,
        { method: 'GET' }
      );

      expect(result.usedMb).toBe(500);
      expect(result.totalMb).toBe(2000);
      expect(result.remainingMb).toBe(1500);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.toISOString()).toBe('2025-03-01T00:00:00.000Z');
    });

    it('computes remainingMb when missing but usedMb and totalMb are provided', async () => {
      telnaRequest.mockResolvedValue({
        usedMb: 100,
        totalMb: 500,
        expiresAt: '2025-04-01T10:00:00.000Z',
      });

      const result = await fetchEsimUsage('profile-abc');

      expect(result).toEqual({
        usedMb: 100,
        totalMb: 500,
        remainingMb: 400,
        expiresAt: new Date('2025-04-01T10:00:00.000Z'),
      });
    });
  });
});
