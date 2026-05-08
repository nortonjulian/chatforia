import { jest } from '@jest/globals';

// ---- mocks ----
const mockReserveEsimProfile = jest.fn();
const mockActivateProfile = jest.fn();
const mockSuspendLine = jest.fn();
const mockResumeLine = jest.fn();
const mockProvisionEsimPack = jest.fn();
const mockFetchEsimUsage = jest.fn();

async function loadSubject({ enabled = true } = {}) {
  jest.resetModules();

  jest.unstable_mockModule('@providers/telnaEsim.js', () => ({
    __esModule: true,
    reserveEsimProfile: mockReserveEsimProfile,
    activateProfile: mockActivateProfile,
    suspendLine: mockSuspendLine,
    resumeLine: mockResumeLine,
    provisionEsimPack: mockProvisionEsimPack,
    fetchEsimUsage: mockFetchEsimUsage,
  }));

  jest.unstable_mockModule('@providers/plintronEsim.js', () => ({
    __esModule: true,
  }));

  jest.unstable_mockModule('@config/esim.js', () => ({
    __esModule: true,
    ESIM_PROVIDER: 'telna',
    ESIM_ENABLED: enabled,
  }));

  return import('@providers/esimProvider.js');
}

describe('esimProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when ESIM feature is disabled', () => {
    const DISABLED_ERROR = 'eSIM feature is disabled';

    it.each([
      ['reserveEsimProfile', 'reserveEsimProfile', { userId: 1, region: 'US' }],
      ['activateProfile', 'activateProfile', { iccid: '123' }],
      ['suspendLine', 'suspendLine', { iccid: '123' }],
      ['resumeLine', 'resumeLine', { iccid: '123' }],
      [
        'provisionEsimPack',
        'provisionEsimPack',
        {
          userId: 1,
          providerProfileId: 'prof-1',
          addonKind: 'DATA',
          planCode: 'US-5GB',
        },
      ],
      ['fetchEsimUsage', 'fetchEsimUsage', 'profile-123'],
    ])('throws when calling %s', async (_name, exportName, arg) => {
      const subject = await loadSubject({ enabled: false });

      await expect(subject[exportName](arg)).rejects.toThrow(DISABLED_ERROR);
    });
  });

  describe('reserveEsimProfile', () => {
    it('delegates to telna.reserveEsimProfile when enabled', async () => {
      const { reserveEsimProfile } = await loadSubject({ enabled: true });

      const params = { userId: 1, region: 'US' };

      mockReserveEsimProfile.mockResolvedValue({
        ok: true,
        foo: 'bar',
      });

      const result = await reserveEsimProfile(params);

      expect(mockReserveEsimProfile).toHaveBeenCalledTimes(1);
      expect(mockReserveEsimProfile).toHaveBeenCalledWith(params);

      expect(result).toEqual({
        ok: true,
        foo: 'bar',
      });
    });

    it('throws provider-wrapped error if Telna reserveEsimProfile fails', async () => {
      const { reserveEsimProfile } = await loadSubject({ enabled: true });

      mockReserveEsimProfile.mockRejectedValue(new Error('Telna unavailable'));

      await expect(
        reserveEsimProfile({
          userId: 1,
          region: 'US',
        })
      ).rejects.toThrow(
        'eSIM provider (telna) error in reserveEsimProfile: Telna unavailable'
      );
    });
  });

  describe('activateProfile', () => {
    it('delegates to telna.activateProfile when enabled', async () => {
      const { activateProfile } = await loadSubject({ enabled: true });

      const params = {
        iccid: 'iccid-123',
        activationCode: 'CODE',
      };

      mockActivateProfile.mockResolvedValue({
        ok: true,
        status: 'activated',
      });

      const result = await activateProfile(params);

      expect(mockActivateProfile).toHaveBeenCalledWith(params);

      expect(result).toEqual({
        ok: true,
        status: 'activated',
      });
    });
  });

  describe('suspendLine', () => {
    it('delegates to telna.suspendLine when enabled', async () => {
      const { suspendLine } = await loadSubject({ enabled: true });

      const params = {
        iccid: 'iccid-123',
      };

      mockSuspendLine.mockResolvedValue({
        ok: true,
        status: 'suspended',
      });

      const result = await suspendLine(params);

      expect(mockSuspendLine).toHaveBeenCalledWith(params);

      expect(result).toEqual({
        ok: true,
        status: 'suspended',
      });
    });
  });

  describe('resumeLine', () => {
    it('delegates to telna.resumeLine when enabled', async () => {
      const { resumeLine } = await loadSubject({ enabled: true });

      const params = {
        iccid: 'iccid-123',
      };

      mockResumeLine.mockResolvedValue({
        ok: true,
        status: 'resumed',
      });

      const result = await resumeLine(params);

      expect(mockResumeLine).toHaveBeenCalledWith(params);

      expect(result).toEqual({
        ok: true,
        status: 'resumed',
      });
    });
  });

  describe('provisionEsimPack', () => {
    it('delegates to telna.provisionEsimPack when enabled', async () => {
      const { provisionEsimPack } = await loadSubject({ enabled: true });

      const params = {
        userId: 7,
        providerProfileId: 'prof-1',
        addonKind: 'DATA_PACK',
        planCode: 'US-5GB',
      };

      mockProvisionEsimPack.mockResolvedValue({
        providerProfileId: 'prof-123',
      });

      const result = await provisionEsimPack(params);

      expect(mockProvisionEsimPack).toHaveBeenCalledWith(params);

      expect(result).toEqual({
        providerProfileId: 'prof-123',
      });
    });
  });

  describe('fetchEsimUsage', () => {
    it('delegates to telna.fetchEsimUsage when enabled', async () => {
      const { fetchEsimUsage } = await loadSubject({ enabled: true });

      mockFetchEsimUsage.mockResolvedValue({
        usedMb: 100,
        totalMb: 500,
      });

      const result = await fetchEsimUsage('profile-123');

      expect(mockFetchEsimUsage).toHaveBeenCalledWith('profile-123');

      expect(result).toEqual({
        usedMb: 100,
        totalMb: 500,
      });
    });
  });
});