// ---- Mocks ----
// Mock the runtime config so tests can toggle whether PLINTRON.apiKey exists
jest.mock('../../../config/esim.js', () => {
  let apiKey = 'TEST_API_KEY';
  return {
    get PLINTRON() {
      return { apiKey };
    },
    __setPlintronApiKey: (val) => {
      apiKey = val;
    },
  };
});

// Mock the plintron client used to make HTTP requests to the provider
jest.mock('../../../utils/plintronClient.js', () => ({
  plintronRequest: jest.fn(),
}));

const { __setPlintronApiKey } = require('../../../config/esim.js');
const { plintronRequest } = require('../../../utils/plintronClient.js');

const {
  reserveEsimProfile,
  activateProfile,
  suspendLine,
  resumeLine,
  provisionEsimPack,
  fetchEsimUsage,
} = require('../plintronEsim.js');

describe('plintronEsim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // ensure configured by default
    __setPlintronApiKey('TEST_API_KEY');
  });

  describe('ensureConfigured / missing API key', () => {
    beforeEach(() => {
      __setPlintronApiKey(undefined);
    });

    it('reserveEsimProfile throws when PLINTRON not configured', async () => {
      await expect(reserveEsimProfile({ region: 'US' })).rejects.toHaveProperty(
        'code',
        'PLINTRON_NOT_CONFIGURED'
      );
    });

    it('activateProfile throws when PLINTRON not configured', async () => {
      await expect(activateProfile({ providerProfileId: 'p' })).rejects.toHaveProperty(
        'code',
        'PLINTRON_NOT_CONFIGURED'
      );
    });

    it('suspendLine throws when PLINTRON not configured', async () => {
      await expect(suspendLine({ providerProfileId: 'p' })).rejects.toHaveProperty(
        'code',
        'PLINTRON_NOT_CONFIGURED'
      );
    });

    it('resumeLine throws when PLINTRON not configured', async () => {
      await expect(resumeLine({ providerProfileId: 'p' })).rejects.toHaveProperty(
        'code',
        'PLINTRON_NOT_CONFIGURED'
      );
    });

    it('provisionEsimPack throws when PLINTRON not configured', async () => {
      await expect(
        provisionEsimPack({ userId: 1, providerProfileId: 'p', addonKind: 'DATA' })
      ).rejects.toHaveProperty('code', 'PLINTRON_NOT_CONFIGURED');
    });

    it('fetchEsimUsage throws when PLINTRON not configured', async () => {
      await expect(fetchEsimUsage('prof-1')).rejects.toHaveProperty('code', 'PLINTRON_NOT_CONFIGURED');
    });
  });

  describe('parameter validation', () => {
    it('reserveEsimProfile requires region (string)', async () => {
      await expect(reserveEsimProfile({})).rejects.toHaveProperty('code', 'PLINTRON_INVALID_REGION');
      await expect(reserveEsimProfile({ region: 123 })).rejects.toHaveProperty(
        'code',
        'PLINTRON_INVALID_REGION'
      );
    });

    it('activateProfile requires at least one identifier', async () => {
      await expect(activateProfile({})).rejects.toHaveProperty(
        'code',
        'PLINTRON_MISSING_ACTIVATION_IDENTIFIERS'
      );
    });

    it('suspendLine requires providerProfileId or iccid', async () => {
      await expect(suspendLine({})).rejects.toHaveProperty('code', 'PLINTRON_MISSING_IDENTIFIER');
    });

    it('resumeLine requires providerProfileId or iccid', async () => {
      await expect(resumeLine({})).rejects.toHaveProperty('code', 'PLINTRON_MISSING_IDENTIFIER');
    });

    it('provisionEsimPack requires userId, providerProfileId and addonKind', async () => {
      await expect(provisionEsimPack({})).rejects.toHaveProperty(
        'code',
        'PLINTRON_INVALID_PROVISION_PARAMS'
      );
    });

    it('fetchEsimUsage requires providerProfileId', async () => {
      await expect(fetchEsimUsage()).rejects.toHaveProperty('code', 'PLINTRON_INVALID_PROFILE_ID');
    });
  });

  describe('reserveEsimProfile', () => {
    it('calls plintronRequest and maps response fields', async () => {
      const mockData = {
        profileId: 'prof-1',
        smdp: 'smdp.example',
        matchingId: 'ACTCODE',
        lpaUri: 'lpa://uri',
        qr: '<qr>',
        iccidHint: 'iccid-hint-1',
        extra: { foo: 'bar' },
      };
      plintronRequest.mockResolvedValue(mockData);

      const result = await reserveEsimProfile({ userId: 42, region: 'US' });

      expect(plintronRequest).toHaveBeenCalledTimes(1);
      expect(plintronRequest).toHaveBeenCalledWith('/esim/reserve', {
        method: 'POST',
        body: expect.objectContaining({
          externalUserId: '42',
          region: 'US',
        }),
      });

      expect(result).toEqual({
        providerProfileId: 'prof-1',
        smdp: 'smdp.example',
        activationCode: 'ACTCODE',
        lpaUri: 'lpa://uri',
        qrPayload: '<qr>',
        iccid: 'iccid-hint-1',
        iccidHint: 'iccid-hint-1',
        providerMeta: mockData,
      });
    });
  });

  describe('activateProfile', () => {
    it('calls plintronRequest and returns ok and parsed activatedAt when provided', async () => {
      const now = new Date().toISOString();
      const mockData = {
        ok: true,
        activatedAt: now,
        msisdn: '+15551234',
        other: 'x',
      };
      plintronRequest.mockResolvedValue(mockData);

      const res = await activateProfile({ providerProfileId: 'prof-1' });

      expect(plintronRequest).toHaveBeenCalledWith('/esim/activate', {
        method: 'POST',
        body: expect.objectContaining({ profileId: 'prof-1' }),
      });

      expect(res.ok).toBe(true);
      expect(res.msisdn).toBe('+15551234');
      // activatedAt should be a Date equal to the provided timestamp
      expect(res.activatedAt instanceof Date).toBe(true);
      expect(res.activatedAt.toISOString()).toBe(now);
      expect(res.providerMeta).toEqual(mockData);
    });

    it('sets activatedAt to Date() when provider does not return activatedAt', async () => {
      plintronRequest.mockResolvedValue({ ok: true, msisdn: '+1555' });

      const res = await activateProfile({ activationCode: 'CODE' });

      expect(res.ok).toBe(true);
      expect(res.msisdn).toBe('+1555');
      expect(res.activatedAt instanceof Date).toBe(true);
      expect(res.providerMeta).toEqual({ ok: true, msisdn: '+1555' });
    });
  });

  describe('suspendLine', () => {
    it('calls suspend endpoint and returns ok true when provider responds ok', async () => {
      plintronRequest.mockResolvedValue({ ok: true, something: 'x' });

      const res = await suspendLine({ providerProfileId: 'prof-1' });

      expect(plintronRequest).toHaveBeenCalledWith('/esim/prof-1/suspend', { method: 'POST' });
      expect(res).toEqual({ ok: true, providerMeta: { ok: true, something: 'x' } });
    });

    it('allows iccid to be used and encodes it', async () => {
      plintronRequest.mockResolvedValue({ ok: true });
      const res = await suspendLine({ iccid: 'iccid/with/slash' });

      expect(plintronRequest).toHaveBeenCalledWith(
        `/esim/${encodeURIComponent('iccid/with/slash')}/suspend`,
        { method: 'POST' }
      );
      expect(res.ok).toBe(true);
    });
  });

  describe('resumeLine', () => {
    it('calls resume endpoint and returns ok true when provider responds ok', async () => {
      plintronRequest.mockResolvedValue({ ok: true, foo: 'bar' });

      const res = await resumeLine({ providerProfileId: 'prof-1' });

      expect(plintronRequest).toHaveBeenCalledWith('/esim/prof-1/resume', { method: 'POST' });
      expect(res).toEqual({ ok: true, providerMeta: { ok: true, foo: 'bar' } });
    });
  });

  describe('provisionEsimPack', () => {
    it('calls provision and maps fields including dates and dataMb', async () => {
      const mockData = {
        purchaseId: 'purchase-1',
        profileId: 'prof-1',
        iccid: 'iccid-1',
        qrCodeSvg: '<svg/>',
        expiresAt: '2026-02-26T12:00:00.000Z',
        dataMb: 5000,
      };
      plintronRequest.mockResolvedValue(mockData);

      const result = await provisionEsimPack({
        userId: 9,
        providerProfileId: 'prof-1',
        addonKind: 'DATA_PACK',
        planCode: 'PLAN-1',
      });

      expect(plintronRequest).toHaveBeenCalledWith('/esim/provision', {
        method: 'POST',
        body: expect.objectContaining({
          externalUserId: '9',
          profileId: 'prof-1',
          addonKind: 'DATA_PACK',
          planCode: 'PLAN-1',
        }),
      });

      expect(result.providerPurchaseId).toBe('purchase-1');
      expect(result.providerProfileId).toBe('prof-1');
      expect(result.iccid).toBe('iccid-1');
      expect(result.qrCodeSvg).toBe('<svg/>');
      expect(result.expiresAt instanceof Date).toBe(true);
      expect(result.dataMb).toBe(5000);
      expect(result.providerMeta).toEqual(mockData);
    });

    it('falls back to alternative field names', async () => {
      const mockData = {
        id: 'id-1',
        profileId: 'prof-1',
        iccid: 'iccid-2',
        qr: '<svg/>',
        totalMb: 2000,
      };
      plintronRequest.mockResolvedValue(mockData);

      const result = await provisionEsimPack({
        userId: 7,
        providerProfileId: 'prof-1',
        addonKind: 'DATA_PACK',
        planCode: 'code',
      });

      expect(result.providerPurchaseId).toBe('id-1');
      expect(result.qrCodeSvg).toBe('<svg/>');
      expect(result.dataMb).toBe(2000);
    });
  });

  describe('fetchEsimUsage', () => {
    it('calls usage endpoint and returns used/total/remaining/expiresAt', async () => {
      const mockData = {
        usedMb: 100,
        totalMb: 1000,
        expiresAt: '2026-03-01T00:00:00.000Z',
      };
      plintronRequest.mockResolvedValue(mockData);

      const res = await fetchEsimUsage('prof-123');

      expect(plintronRequest).toHaveBeenCalledWith('/esim/prof-123/usage', { method: 'GET' });
      expect(res.usedMb).toBe(100);
      expect(res.totalMb).toBe(1000);
      expect(res.remainingMb).toBe(900);
      expect(res.expiresAt instanceof Date).toBe(true);
      expect(res.providerMeta).toEqual(mockData);
    });

    it('computes remainingMb when remainingMb provided', async () => {
      plintronRequest.mockResolvedValue({ usedMb: 50, totalMb: 200, remainingMb: 150 });

      const res = await fetchEsimUsage('prof-xyz');

      expect(res.remainingMb).toBe(150);
    });
  });
});