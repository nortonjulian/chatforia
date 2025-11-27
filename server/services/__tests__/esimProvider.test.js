// ---- Mocks ----
jest.mock('./telnaEsim.js', () => ({
  reserveEsimProfile: jest.fn(),
  activateProfile: jest.fn(),
  suspendLine: jest.fn(),
  resumeLine: jest.fn(),
  provisionEsimPack: jest.fn(),
  fetchEsimUsage: jest.fn(),
}));

// We want ESIM_ENABLED to be toggleable per-test.
jest.mock('../../config/esim.js', () => {
  let enabled = true;
  return {
    get ESIM_ENABLED() {
      return enabled;
    },
    __setEsimEnabled: (val) => {
      enabled = val;
    },
  };
});

const telna = require('./telnaEsim.js');
const esimConfig = require('../../config/esim.js');

const {
  reserveEsimProfile,
  activateProfile,
  suspendLine,
  resumeLine,
  provisionEsimPack,
  fetchEsimUsage,
} = require('./esimProvider.js');

describe('esimProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure eSIM is enabled by default
    esimConfig.__setEsimEnabled(true);
  });

  describe('when ESIM feature is disabled', () => {
    beforeEach(() => {
      esimConfig.__setEsimEnabled(false);
    });

    const DISABLED_ERROR = 'eSIM feature is disabled';

    it.each([
      ['reserveEsimProfile', reserveEsimProfile, { userId: 1, region: 'US' }],
      ['activateProfile', activateProfile, { iccid: '123', code: 'ABC' }],
      ['suspendLine', suspendLine, { iccid: '123' }],
      ['resumeLine', resumeLine, { iccid: '123' }],
      ['provisionEsimPack', provisionEsimPack, { userId: 1, addonKind: 'DATA', planCode: 'US-5GB' }],
      ['fetchEsimUsage', fetchEsimUsage, 'profile-123'],
    ])('throws when calling %s', async (_name, fn, arg) => {
      await expect(fn(arg)).rejects.toThrow(DISABLED_ERROR);
    });
  });

  describe('reserveEsimProfile', () => {
    it('delegates to telna.reserveEsimProfile when enabled', async () => {
      const params = { userId: 1, region: 'US' };
      telna.reserveEsimProfile.mockResolvedValue({ ok: true, foo: 'bar' });

      const result = await reserveEsimProfile(params);

      expect(telna.reserveEsimProfile).toHaveBeenCalledTimes(1);
      expect(telna.reserveEsimProfile).toHaveBeenCalledWith(params);
      expect(result).toEqual({ ok: true, foo: 'bar' });
    });

    it('throws if Telna reserveEsimProfile is not implemented', async () => {
      telna.reserveEsimProfile = undefined;

      await expect(
        reserveEsimProfile({ userId: 1, region: 'US' })
      ).rejects.toThrow('reserveEsimProfile not implemented for Telna');
    });
  });

  describe('activateProfile', () => {
    it('delegates to telna.activateProfile when enabled', async () => {
      const params = { iccid: 'iccid-123', code: 'CODE' };
      telna.activateProfile.mockResolvedValue({ ok: true, status: 'activated' });

      const result = await activateProfile(params);

      expect(telna.activateProfile).toHaveBeenCalledTimes(1);
      expect(telna.activateProfile).toHaveBeenCalledWith(params);
      expect(result).toEqual({ ok: true, status: 'activated' });
    });

    it('throws if Telna activateProfile is not implemented', async () => {
      telna.activateProfile = undefined;

      await expect(
        activateProfile({ iccid: 'iccid-123', code: 'CODE' })
      ).rejects.toThrow('activateProfile not implemented for Telna');
    });
  });

  describe('suspendLine', () => {
    it('delegates to telna.suspendLine when enabled', async () => {
      const params = { iccid: 'iccid-123' };
      telna.suspendLine.mockResolvedValue({ ok: true, status: 'suspended' });

      const result = await suspendLine(params);

      expect(telna.suspendLine).toHaveBeenCalledTimes(1);
      expect(telna.suspendLine).toHaveBeenCalledWith(params);
      expect(result).toEqual({ ok: true, status: 'suspended' });
    });

    it('throws if Telna suspendLine is not implemented', async () => {
      telna.suspendLine = undefined;

      await expect(
        suspendLine({ iccid: 'iccid-123' })
      ).rejects.toThrow('suspendLine not implemented for Telna');
    });
  });

  describe('resumeLine', () => {
    it('delegates to telna.resumeLine when enabled', async () => {
      const params = { iccid: 'iccid-123' };
      telna.resumeLine.mockResolvedValue({ ok: true, status: 'resumed' });

      const result = await resumeLine(params);

      expect(telna.resumeLine).toHaveBeenCalledTimes(1);
      expect(telna.resumeLine).toHaveBeenCalledWith(params);
      expect(result).toEqual({ ok: true, status: 'resumed' });
    });

    it('throws if Telna resumeLine is not implemented', async () => {
      telna.resumeLine = undefined;

      await expect(
        resumeLine({ iccid: 'iccid-123' })
      ).rejects.toThrow('resumeLine not implemented for Telna');
    });
  });

  describe('provisionEsimPack', () => {
    it('delegates to telna.provisionEsimPack when enabled', async () => {
      const params = { userId: 7, addonKind: 'DATA_PACK', planCode: 'US-5GB' };
      telna.provisionEsimPack.mockResolvedValue({
        providerProfileId: 'prof-123',
      });

      const result = await provisionEsimPack(params);

      expect(telna.provisionEsimPack).toHaveBeenCalledTimes(1);
      expect(telna.provisionEsimPack).toHaveBeenCalledWith(params);
      expect(result).toEqual({ providerProfileId: 'prof-123' });
    });

    it('throws if Telna provisionEsimPack is not implemented', async () => {
      telna.provisionEsimPack = undefined;

      await expect(
        provisionEsimPack({ userId: 7, addonKind: 'DATA_PACK', planCode: 'US-5GB' })
      ).rejects.toThrow('provisionEsimPack not implemented for Telna');
    });
  });

  describe('fetchEsimUsage', () => {
    it('delegates to telna.fetchEsimUsage when enabled', async () => {
      telna.fetchEsimUsage.mockResolvedValue({
        usedMb: 100,
        totalMb: 500,
      });

      const result = await fetchEsimUsage('profile-123');

      expect(telna.fetchEsimUsage).toHaveBeenCalledTimes(1);
      expect(telna.fetchEsimUsage).toHaveBeenCalledWith('profile-123');
      expect(result).toEqual({ usedMb: 100, totalMb: 500 });
    });

    it('throws if Telna fetchEsimUsage is not implemented', async () => {
      telna.fetchEsimUsage = undefined;

      await expect(
        fetchEsimUsage('profile-123')
      ).rejects.toThrow('fetchEsimUsage not implemented for Telna');
    });
  });
});
