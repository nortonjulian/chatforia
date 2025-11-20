import { jest } from '@jest/globals';

// ---- Mocks ----

// Mutable Teal config we can tweak per test.
const tealConfig = {
  TEAL: {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.teal.test',
    partnerId: 'partner-123',
  },
};

const fetchMock = jest.fn();

// Mock node-fetch with our fetchMock function.
jest.unstable_mockModule('node-fetch', () => ({
  default: fetchMock,
}));

// Mock the TEAL config module that tealClient.js imports.
jest.unstable_mockModule('../config/esim.js', () => tealConfig);

// Import the module under test *after* setting up mocks.
const { provisionEsimPack, fetchEsimUsage } = await import('./tealClient.js');

describe('tealClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    tealConfig.TEAL.apiKey = 'test-api-key';
    tealConfig.TEAL.baseUrl = 'https://api.teal.test';
    tealConfig.TEAL.partnerId = 'partner-123';
  });

  describe('provisionEsimPack', () => {
    it('returns a stub and logs a warning when Teal is not configured', async () => {
      tealConfig.TEAL.apiKey = undefined;

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await provisionEsimPack({
        userId: 123,
        addonKind: 'ESIM_STARTER',
        planCode: 'PLAN_STARTER',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('provisionEsimPack called but Teal is not configured. ' +
          'Returning stub provision result for'),
        'ESIM_STARTER'
      );

      expect(result).toEqual({
        tealProfileId: null,
        qrCodeSvg: null,
        iccid: null,
        expiresAt: null,
        dataMb: null,
      });

      expect(fetchMock).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('calls Teal API with correct payload and maps response fields', async () => {
      const tealResponse = {
        profileId: 'prof_123',
        qrCodeSvg: '<svg>qr</svg>',
        iccid: '8901234567890',
        expiresAt: '2030-01-01T00:00:00.000Z',
        dataMb: 2048,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(tealResponse),
      });

      const result = await provisionEsimPack({
        userId: 42,
        addonKind: 'ESIM_TRAVELER',
        planCode: 'PLAN_TRAVELER',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.teal.test/esim/provision',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            externalUserId: '42',
            addonKind: 'ESIM_TRAVELER',
            planCode: 'PLAN_TRAVELER',
            partnerId: 'partner-123',
          }),
        }
      );

      expect(result).toEqual({
        tealProfileId: 'prof_123',
        qrCodeSvg: '<svg>qr</svg>',
        iccid: '8901234567890',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        dataMb: 2048,
      });
    });

    it('falls back to totalMb when dataMb is missing', async () => {
      const tealResponse = {
        id: 'prof_999',
        qrCodeSvg: '<svg>qr</svg>',
        iccid: '8900000000000',
        expiresAt: '2031-06-01T00:00:00.000Z',
        totalMb: 512,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(tealResponse),
      });

      const result = await provisionEsimPack({
        userId: 7,
        addonKind: 'ESIM_POWER',
        planCode: 'PLAN_POWER',
      });

      expect(result.dataMb).toBe(512);
      expect(result.tealProfileId).toBe('prof_999'); // uses id fallback
    });

    it('throws a helpful error when Teal API returns non-OK', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error from Teal'),
      });

      await expect(
        provisionEsimPack({
          userId: 1,
          addonKind: 'ESIM_STARTER',
          planCode: 'PLAN_STARTER',
        })
      ).rejects.toThrow('Teal API error 500: Internal error from Teal');
    });
  });

  describe('fetchEsimUsage', () => {
    it('returns null usage and logs a warning when Teal is not configured', async () => {
      tealConfig.TEAL.apiKey = undefined;

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await fetchEsimUsage('profile_abc');

      expect(warnSpy).toHaveBeenCalledWith(
        '[tealClient] fetchEsimUsage called but Teal is not configured – returning null usage.'
      );

      expect(result).toEqual({
        usedMb: null,
        totalMb: null,
        remainingMb: null,
        expiresAt: null,
      });

      expect(fetchMock).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('calls Teal usage endpoint and maps response directly when remainingMb is present', async () => {
      const tealUsage = {
        usedMb: 100,
        totalMb: 1000,
        remainingMb: 900,
        expiresAt: '2030-05-01T00:00:00.000Z',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(tealUsage),
      });

      const result = await fetchEsimUsage('profile_abc');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.teal.test/esim/profile_abc/usage',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
          body: undefined,
        }
      );

      expect(result).toEqual({
        usedMb: 100,
        totalMb: 1000,
        remainingMb: 900,
        expiresAt: new Date('2030-05-01T00:00:00.000Z'),
      });
    });

    it('derives remainingMb from totalMb - usedMb when remainingMb is missing', async () => {
      const tealUsage = {
        usedMb: 250,
        totalMb: 1000,
        expiresAt: '2030-05-01T00:00:00.000Z',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(tealUsage),
      });

      const result = await fetchEsimUsage('profile_xyz');

      expect(result).toEqual({
        usedMb: 250,
        totalMb: 1000,
        remainingMb: 750,
        expiresAt: new Date('2030-05-01T00:00:00.000Z'),
      });
    });

    it('propagates Teal API errors via the internal tealRequest', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      });

      await expect(fetchEsimUsage('missing_profile')).rejects.toThrow(
        'Teal API error 404: Not found'
      );
    });
  });
});
