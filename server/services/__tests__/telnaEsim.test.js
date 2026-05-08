import { jest } from '@jest/globals';

const telnaRequestMock = jest.fn();

jest.unstable_mockModule('../config/esim.js', () => ({
  __esModule: true,
  getEsimProviderConfig: jest.fn(() => ({
    baseUrl: 'https://test.telna.com',
    apiKey: 'test-api-key',
    partnerId: 'partner-123',
  })),
}));

jest.unstable_mockModule('../utils/telnaClient.js', () => ({
  __esModule: true,
  telnaRequest: telnaRequestMock,
}));

const {
  reserveEsimProfile,
  activateProfile,
  suspendLine,
  resumeLine,
  provisionEsimPack,
  fetchEsimUsage,
} = await import('../providers/telnaEsim.js');

describe('telnaEsim provider', () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('reserveEsimProfile', () => {
    it('calls telnaRequest with correct payload and normalizes response', async () => {
      telnaRequestMock.mockResolvedValue({
        smDpPlus: 'smdp+val',
        matchingId: 'match-123',
        qrPayload: 'LPA:1$xyz',
        iccidHint: '8901',
      });

      const result = await reserveEsimProfile({
        userId: 42,
        region: 'EU',
      });

      expect(telnaRequestMock).toHaveBeenCalledTimes(1);

      expect(telnaRequestMock).toHaveBeenCalledWith('/esim/reserve', {
        method: 'POST',
        body: {
          externalUserId: '42',
          region: 'EU',
        },
      });

      expect(result).toEqual({
        providerProfileId: null,
        iccid: null,
        iccidHint: '8901',
        smdp: 'smdp+val',
        activationCode: 'match-123',
        lpaUri: null,
        qrPayload: 'LPA:1$xyz',
        providerMeta: {
          smDpPlus: 'smdp+val',
          matchingId: 'match-123',
          qrPayload: 'LPA:1$xyz',
          iccidHint: '8901',
        },
      });
    });
  });

  describe('activateProfile', () => {
    it('posts correct payload and returns normalized data', async () => {
      telnaRequestMock.mockResolvedValue({
        ok: true,
        activatedAt: '2025-01-01T00:00:00.000Z',
        msisdn: '+15555555555',
      });

      const result = await activateProfile({
        iccid: '123',
        activationCode: 'ABC',
      });

      expect(telnaRequestMock).toHaveBeenCalledWith('/esim/activate', {
        method: 'POST',
        body: {
          profileId: undefined,
          iccid: '123',
          activationCode: 'ABC',
        },
      });

      expect(result.ok).toBe(true);
      expect(result.msisdn).toBe('+15555555555');
      expect(result.activatedAt).toBeInstanceOf(Date);
    });
  });

  describe('suspendLine', () => {
    it('calls telnaRequest with encoded ICCID and POST method', async () => {
      telnaRequestMock.mockResolvedValue({ ok: true });

      const iccid = 'ic cid/with spaces';

      const result = await suspendLine({ iccid });

      expect(telnaRequestMock).toHaveBeenCalledWith(
        `/esim/${encodeURIComponent(iccid)}/suspend`,
        { method: 'POST' }
      );

      expect(result).toEqual({
        ok: true,
        providerMeta: { ok: true },
      });
    });
  });

  describe('resumeLine', () => {
    it('calls telnaRequest with encoded ICCID and POST method', async () => {
      telnaRequestMock.mockResolvedValue({ ok: true });

      const iccid = 'ic cid/with spaces';

      const result = await resumeLine({ iccid });

      expect(telnaRequestMock).toHaveBeenCalledWith(
        `/esim/${encodeURIComponent(iccid)}/resume`,
        { method: 'POST' }
      );

      expect(result).toEqual({
        ok: true,
        providerMeta: { ok: true },
      });
    });
  });

  describe('provisionEsimPack', () => {
    it('calls telnaRequest with correct payload and maps response', async () => {
      telnaRequestMock.mockResolvedValue({
        profileId: 'profile-123',
        qrCodeSvg: '<svg>qr</svg>',
        iccid: '8901',
        expiresAt: '2025-01-01T00:00:00.000Z',
        dataMb: 1024,
      });

      const result = await provisionEsimPack({
        userId: 7,
        providerProfileId: 'profile-123',
        addonKind: 'DATA_PACK',
        planCode: 'US-10GB',
      });

      expect(telnaRequestMock).toHaveBeenCalledWith('/esim/provision', {
        method: 'POST',
        body: {
          externalUserId: '7',
          profileId: 'profile-123',
          addonKind: 'DATA_PACK',
          planCode: 'US-10GB',
          partnerId: 'partner-123',
        },
      });

      expect(result.providerProfileId).toBe('profile-123');
      expect(result.qrCodeSvg).toBe('<svg>qr</svg>');
      expect(result.iccid).toBe('8901');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.dataMb).toBe(1024);
    });
  });

  describe('fetchEsimUsage', () => {
    it('maps usage correctly', async () => {
      telnaRequestMock.mockResolvedValue({
        usedMb: 500,
        totalMb: 2000,
        remainingMb: 1500,
        expiresAt: '2025-03-01T00:00:00.000Z',
      });

      const result = await fetchEsimUsage('profile with spaces');

      expect(telnaRequestMock).toHaveBeenCalledWith(
        `/esim/${encodeURIComponent('profile with spaces')}/usage`,
        { method: 'GET' }
      );

      expect(result.usedMb).toBe(500);
      expect(result.totalMb).toBe(2000);
      expect(result.remainingMb).toBe(1500);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });
});