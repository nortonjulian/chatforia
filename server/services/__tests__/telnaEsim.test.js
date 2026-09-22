import { jest } from '@jest/globals';

const telnaRequestMock = jest.fn();

jest.unstable_mockModule('../config/esim.js', () => ({
  __esModule: true,
  getEsimProviderConfig: jest.fn(() => ({
    baseUrl: 'https://developer-api.telna.com',
    apiKey: 'test-api-key',
    inventoryId: 52187,
    groupId: null,
    packageTemplateMap: {
      'US-10GB': 900001,
      DATA_PACK: 900002,
    },
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('reserveEsimProfile', () => {
    it('discovers an available SIM and retrieves its eUICC profile', async () => {
      const telnaLpa =
        'LPA:1$smdp.example.test$REAL-TELNA-ACTIVATION-CODE';
      telnaRequestMock
        .mockResolvedValueOnce({
          offset: 0,
          total: 1,
          sims: [
            {
              iccid: '8910300000059080801',
              sim_status: 'pre-service',
              sim_type: 'Classic',
              sim_variance: 'TEST',
              group: 1111437,
              inventory: 52187,
              company: 72800,
              created_date: '2026-09-01T00:00:00Z',
              modified_date: '2026-09-01T00:00:00Z',
              removed_date: null,
              imsis: [312300051404901],
              mapped_imsi: 312300051404901,
            },
          ],
        })
        .mockResolvedValueOnce({
          iccid: '8910300000059080801',
          imsi: '312300051404901',
          state: 'AVAILABLE',
          last_operation_date: '2026-09-01T00:00:00Z',
          activation_code: telnaLpa,
          release_date: null,
          cc_required: false,
          cc_retries: 0,
          eid: '',
        });

      const result = await reserveEsimProfile({
        userId: 42,
        region: 'GLOBAL',
      });

      expect(telnaRequestMock).toHaveBeenCalledTimes(2);

      expect(telnaRequestMock).toHaveBeenNthCalledWith(
        1,
        '/v2.1/inventory/sim-registries?inventory=52187&count=100&offset=0',
        {
          method: 'GET',
        }
      );

      expect(telnaRequestMock).toHaveBeenNthCalledWith(
        2,
        '/v2.1/esim-rsp/euicc-profiles/8910300000059080801',
        {
          method: 'GET',
        }
      );

      expect(result.providerProfileId).toBe(
        '8910300000059080801'
      );

      expect(result.iccid).toBe(
        '8910300000059080801'
      );

      expect(result.activationCode).toBe(telnaLpa);

      /*
      * Telna supplies the complete LPA payload in activation_code.
      * Preserve it exactly rather than constructing one locally.
      */
      expect(result.smdp).toBeNull();
      expect(result.lpaUri).toBe(telnaLpa);
      expect(result.qrPayload).toBe(telnaLpa);

      expect(result.providerMeta.euiccProfile.state).toBe('AVAILABLE');
    });

    it('skips ICCIDs already excluded by the caller', async () => {
      telnaRequestMock
        .mockResolvedValueOnce({
          offset: 0,
          total: 2,
          sims: [
            {
              iccid: '8910300000059080801',
              sim_status: 'pre-service',
            },
            {
              iccid: '8910300000059080802',
              sim_status: 'pre-service',
            },
          ],
        })
        .mockResolvedValueOnce({
          iccid: '8910300000059080802',
          state: 'AVAILABLE',
          activation_code: 'ACTIVATION-2',
        });

      const result = await reserveEsimProfile({
        userId: 42,
        region: 'GLOBAL',
        excludedIccids: [
          '8910300000059080801',
        ],
      });

      expect(telnaRequestMock).toHaveBeenCalledTimes(2);

      expect(telnaRequestMock).toHaveBeenNthCalledWith(
        2,
        '/v2.1/esim-rsp/euicc-profiles/8910300000059080802',
        {
          method: 'GET',
        }
      );

      expect(result.iccid).toBe(
        '8910300000059080802'
      );
    });

    it('accepts a pre-service RELEASED eUICC profile with an activation code', async () => {
      telnaRequestMock
        .mockResolvedValueOnce({
          offset: 0,
          total: 1,
          sims: [
            {
              iccid: '8910300000059080801',
              sim_status: 'pre-service',
            },
          ],
        })
        .mockResolvedValueOnce({
          iccid: '8910300000059080801',
          state: 'RELEASED',
          activation_code: 'RELEASED-ACTIVATION',
          eid: '',
        });

      const result = await reserveEsimProfile({
        userId: 42,
        region: 'GLOBAL',
      });

      expect(telnaRequestMock).toHaveBeenCalledTimes(2);

      expect(result.iccid).toBe(
        '8910300000059080801'
      );

      expect(result.activationCode).toBe(
        'RELEASED-ACTIVATION'
      );

      expect(result.lpaUri).toBeNull();
      expect(result.qrPayload).toBeNull();

      expect(
        result.providerMeta.euiccProfile.state
      ).toBe('RELEASED');
    });

    it('skips an in-service DISABLED profile and selects an eligible pre-service profile', async () => {
      telnaRequestMock
        .mockResolvedValueOnce({
          offset: 0,
          total: 2,
          sims: [
            {
              iccid: '8910300000059080801',
              sim_status: 'in-service',
            },
            {
              iccid: '8910300000059080802',
              sim_status: 'pre-service',
            },
          ],
        })
        .mockResolvedValueOnce({
          iccid: '8910300000059080801',
          state: 'DISABLED',
          activation_code: 'OLD',
          eid: '89000000000000000000000000000001',
        })
        .mockResolvedValueOnce({
          iccid: '8910300000059080802',
          state: 'RELEASED',
          activation_code: 'NEW',
          eid: '',
        });

      const result = await reserveEsimProfile({
        userId: 42,
        region: 'GLOBAL',
      });

      expect(telnaRequestMock).toHaveBeenCalledTimes(3);

      expect(result.iccid).toBe(
        '8910300000059080802'
      );

      expect(result.activationCode).toBe('NEW');
    });

    it('skips a RELEASED profile without an activation code', async () => {
      telnaRequestMock
        .mockResolvedValueOnce({
          offset: 0,
          total: 2,
          sims: [
            {
              iccid: '8910300000059080801',
              sim_status: 'pre-service',
            },
            {
              iccid: '8910300000059080802',
              sim_status: 'pre-service',
            },
          ],
        })
        .mockResolvedValueOnce({
          iccid: '8910300000059080801',
          state: 'RELEASED',
          activation_code: '',
          eid: '',
        })
        .mockResolvedValueOnce({
          iccid: '8910300000059080802',
          state: 'RELEASED',
          activation_code: 'VALID-ACTIVATION',
          eid: '',
        });

      const result = await reserveEsimProfile({
        userId: 42,
        region: 'GLOBAL',
      });

      expect(telnaRequestMock).toHaveBeenCalledTimes(3);

      expect(result.iccid).toBe(
        '8910300000059080802'
      );

      expect(result.activationCode).toBe(
        'VALID-ACTIVATION'
      );
    });

    it('preserves mock reservation behavior without calling Telna', async () => {
      const result = await reserveEsimProfile({
        userId: 42,
        region: 'GLOBAL',
        testMode: true,
      });

      expect(telnaRequestMock).not.toHaveBeenCalled();

      expect(result.providerProfileId).toMatch(
        /^mock-telna-/
      );

      expect(result.iccid).toBeTruthy();
      expect(result.activationCode).toBeTruthy();

      expect(result.lpaUri).toMatch(
        /^LPA:1\$mock\.smdp\.chatforia\.com\$/
      );

      expect(result.qrPayload).toBe(
        result.lpaUri
      );
    });
  });

  describe('activateProfile', () => {
    it('retrieves the eUICC profile and reports ENABLED as active', async () => {
      telnaRequestMock.mockResolvedValue({
        iccid: '8910300000059080801',
        state: 'ENABLED',
        activation_code: 'ACTIVATION',
        last_operation_date:
          '2026-09-19T12:00:00Z',
      });

      const result = await activateProfile({
        iccid: '8910300000059080801',
      });

      expect(telnaRequestMock).toHaveBeenCalledWith(
        '/v2.1/esim-rsp/euicc-profiles/8910300000059080801',
        {
          method: 'GET',
        }
      );

      expect(result.ok).toBe(true);
      expect(result.activatedAt).toBeInstanceOf(Date);
      expect(result.providerMeta.state).toBe('ENABLED');
    });

    it('does not invent an activation POST for a profile that is not ENABLED', async () => {
      telnaRequestMock.mockResolvedValue({
        iccid: '8910300000059080801',
        state: 'AVAILABLE',
        activation_code: 'ACTIVATION',
      });

      const result = await activateProfile({
        providerProfileId:
          '8910300000059080801',
      });

      expect(telnaRequestMock).toHaveBeenCalledTimes(1);

      expect(telnaRequestMock).toHaveBeenCalledWith(
        '/v2.1/esim-rsp/euicc-profiles/8910300000059080801',
        {
          method: 'GET',
        }
      );

      expect(result.ok).toBe(false);
      expect(result.activatedAt).toBeUndefined();
    });
  });

  describe('provisionEsimPack', () => {
    it('creates a Telna package using ICCID and mapped package template', async () => {
      telnaRequestMock.mockResolvedValue({
        id: 456789,
        sim: '8910300000059080801',
        status: 'NOT_ACTIVE',
        created_date:
          '2026-09-19T12:00:00Z',
        expiry_date:
          '2026-10-19T12:00:00Z',
        activated_date: null,
        terminated_date: null,
        data_usage_remaining:
          10737418240,
      });

      const result = await provisionEsimPack({
        userId: 7,
        providerProfileId:
          '8910300000059080801',
        iccid:
          '8910300000059080801',
        addonKind: 'DATA_PACK',
        planCode: 'US-10GB',
      });

      expect(telnaRequestMock).toHaveBeenCalledWith(
        '/v2.1/pcr/packages',
        {
          method: 'POST',
          body: {
            sim: '8910300000059080801',
            package_template: 900001,
          },
        }
      );

      expect(result.providerPurchaseId).toBe(
        '456789'
      );

      expect(result.providerProfileId).toBe(
        '8910300000059080801'
      );

      expect(result.iccid).toBe(
        '8910300000059080801'
      );

      expect(result.expiresAt).toBeInstanceOf(Date);

      /*
       * The package response tells us remaining bytes, but the
       * adapter intentionally does not invent the package's total
       * allowance without retrieving its template.
       */
      expect(result.dataMb).toBeNull();
    });

    it('falls back to addonKind when planCode has no template mapping', async () => {
      telnaRequestMock.mockResolvedValue({
        id: 456790,
        sim: '8910300000059080801',
        status: 'NOT_ACTIVE',
      });

      const result = await provisionEsimPack({
        userId: 7,
        providerProfileId:
          '8910300000059080801',
        addonKind: 'DATA_PACK',
        planCode: 'UNMAPPED-PLAN',
      });

      expect(telnaRequestMock).toHaveBeenCalledWith(
        '/v2.1/pcr/packages',
        {
          method: 'POST',
          body: {
            sim: '8910300000059080801',
            package_template: 900002,
          },
        }
      );

      expect(result.providerPurchaseId).toBe(
        '456790'
      );
    });

    it('fails clearly when no production package template is configured', async () => {
      await expect(
        provisionEsimPack({
          userId: 7,
          providerProfileId:
            '8910300000059080801',
          addonKind: 'UNKNOWN_ADDON',
          planCode: 'UNKNOWN_PLAN',
        })
      ).rejects.toMatchObject({
        code: 'TELNA_PACKAGE_TEMPLATE_NOT_CONFIGURED',
      });

      expect(telnaRequestMock).not.toHaveBeenCalled();
    });

    it('preserves mock package provisioning', async () => {
      const result = await provisionEsimPack({
        userId: 7,
        providerProfileId:
          'mock-telna-profile',
        iccid:
          '8900000000000000001',
        addonKind: 'DATA_PACK',
        planCode: 'US-10GB',
        testMode: true,
      });

      expect(telnaRequestMock).not.toHaveBeenCalled();

      expect(result.providerPurchaseId).toMatch(
        /^mock-purchase-/
      );

      expect(result.providerProfileId).toBe(
        'mock-telna-profile'
      );
    });
  });

  describe('fetchEsimUsage', () => {
    it('retrieves usage by Telna package ID and converts remaining bytes to MB', async () => {
      telnaRequestMock.mockResolvedValue({
        id: 456789,
        sim: '8910300000059080801',
        status: 'ACTIVE',
        expiry_date:
          '2026-10-19T12:00:00Z',
        data_usage_remaining:
          1572864000,
      });

      const result = await fetchEsimUsage(
        '456789'
      );

      expect(telnaRequestMock).toHaveBeenCalledWith(
        '/v2.1/pcr/packages/456789',
        {
          method: 'GET',
        }
      );

      expect(result.usedMb).toBeNull();
      expect(result.totalMb).toBeNull();
      expect(result.remainingMb).toBe(1500);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.providerMeta.id).toBe(456789);
    });
  });

  describe('suspendLine', () => {
    it('disables the Telna SIM PCR profile', async () => {
      telnaRequestMock.mockResolvedValue({
        data: {
          state: 'DISABLED',
          active_throttling: 'NO_LIMIT',
        },
        voice: {
          state: 'DISABLED',
        },
        sms: {
          state: 'DISABLED',
        },
        wallet_mode: 'SIM',
      });

      const result = await suspendLine({
        iccid:
          '8910300000059080801',
      });

      expect(telnaRequestMock).toHaveBeenCalledWith(
        '/v2.1/pcr/sim-pcr-profiles/8910300000059080801',
        {
          method: 'PUT',
          body: {
            data: {
              state: 'DISABLED',
              active_throttling: 'NO_LIMIT',
            },
            voice: {
              state: 'DISABLED',
            },
            sms: {
              state: 'DISABLED',
            },
            wallet_mode: 'SIM',
          },
        }
      );

      expect(result.ok).toBe(true);
      expect(result.providerMeta.data.state).toBe(
        'DISABLED'
      );
    });

    it('preserves mock suspension behavior', async () => {
      const result = await suspendLine({
        providerProfileId:
          'mock-telna-profile',
        testMode: true,
      });

      expect(result.ok).toBe(true);
      expect(telnaRequestMock).not.toHaveBeenCalled();
    });
  });

  describe('resumeLine', () => {
    it('enables the Telna SIM PCR profile', async () => {
      telnaRequestMock.mockResolvedValue({
        data: {
          state: 'ENABLED',
          active_throttling: 'NO_LIMIT',
        },
        voice: {
          state: 'ENABLED',
        },
        sms: {
          state: 'ENABLED',
        },
        wallet_mode: 'SIM',
      });

      const result = await resumeLine({
        iccid:
          '8910300000059080801',
      });

      expect(telnaRequestMock).toHaveBeenCalledWith(
        '/v2.1/pcr/sim-pcr-profiles/8910300000059080801',
        {
          method: 'PUT',
          body: {
            data: {
              state: 'ENABLED',
              active_throttling: 'NO_LIMIT',
            },
            voice: {
              state: 'ENABLED',
            },
            sms: {
              state: 'ENABLED',
            },
            wallet_mode: 'SIM',
          },
        }
      );

      expect(result.ok).toBe(true);
      expect(result.providerMeta.data.state).toBe(
        'ENABLED'
      );
    });

    it('preserves mock resume behavior', async () => {
      const result = await resumeLine({
        providerProfileId:
          'mock-telna-profile',
        testMode: true,
      });

      expect(result.ok).toBe(true);
      expect(telnaRequestMock).not.toHaveBeenCalled();
    });
  });
});