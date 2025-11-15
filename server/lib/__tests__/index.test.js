import { jest } from '@jest/globals';
import { fileURLToPath } from 'url';
import path from 'path';

const ORIGINAL_ENV = { ...process.env };

// Resolve absolute paths so mocks match the SUT's resolved module IDs
const THIS_DIR            = path.dirname(fileURLToPath(import.meta.url));  // .../server/lib/__tests__
const SUT_PATH            = path.resolve(THIS_DIR, '../telco/index.js');   // .../server/lib/telco/index.js
const TWILIO_ADAPTER_PATH = path.resolve(THIS_DIR, '../telco/twilio.js');  // .../server/lib/telco/twilio.js

/**
 * Reload the SUT with configurable environment and module mocks.
 *
 * @param {Object} options
 * @param {boolean} [options.hasTwilioAdapter] - if true, mock adapter exists; if false, adapter "missing" (default export null)
 * @param {Object} [options.env] - process.env overrides
 * @param {function} [options.mockTwilioSdk] - factory to mock 'twilio' package; returns a client with messages.create(...)
 */
const reload = async ({
  hasTwilioAdapter = true,
  env = {},
  mockTwilioSdk = null,
} = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // Mock the optional twilio adapter module. Import('./twilio.js') reads its default.
  if (hasTwilioAdapter) {
    await jest.unstable_mockModule(TWILIO_ADAPTER_PATH, () => ({
      __esModule: true,
      default: { providerName: 'twilio' },  // minimal shape for registry
    }));
  } else {
    // Simulate "missing" by exporting null; index.js maps falsy default to null and omits from registry.
    await jest.unstable_mockModule(TWILIO_ADAPTER_PATH, () => ({
      __esModule: true,
      default: null,
    }));
  }

  // Optionally mock the 'twilio' SDK used by sendSms
  if (mockTwilioSdk) {
    await jest.unstable_mockModule('twilio', () => ({
      __esModule: true,
      default: mockTwilioSdk,
    }));
  } else {
    // Default safe mock that throws if sendSms accidentally tries to hit real SDK
    await jest.unstable_mockModule('twilio', () => ({
      __esModule: true,
      default: () => {
        throw new Error('Twilio SDK not mocked in this test');
      },
    }));
  }

  return import(SUT_PATH);
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* -------------------- Registry & defaults -------------------- */

describe('telco/index registry & defaults', () => {
  test('when Twilio adapter is present: registry has twilio; default is twilio unless DEFAULT_PROVIDER set', async () => {
    const mod = await reload({
      hasTwilioAdapter: true,
      env: { DEFAULT_PROVIDER: '' },
    });

    // Named exports
    expect(mod.providers).toHaveProperty('twilio');
    expect(mod.providerName).toBe('twilio');

    // getProvider behavior
    expect(mod.getProvider('twilio')).toBe(mod.providers.twilio);
    // unknown -> default -> 'twilio'
    expect(mod.getProvider('unknown')).toBe(mod.providers.twilio);

    // DEFAULT_PROVIDER respected
    const mod2 = await reload({
      hasTwilioAdapter: true,
      env: { DEFAULT_PROVIDER: 'twilio' },
    });
    expect(mod2.providerName).toBe('twilio');
  });

  test('DEFAULT_PROVIDER respected when twilio is present', async () => {
    const mod = await reload({
      hasTwilioAdapter: true,
      env: { DEFAULT_PROVIDER: 'twilio' },
    });
    expect(mod.providerName).toBe('twilio');
    expect(mod.getProvider()).toBe(mod.providers.twilio);
  });

  test('when Twilio adapter is "missing": providers empty; default & providerName are mock', async () => {
    const mod = await reload({
      hasTwilioAdapter: false,
      env: { DEFAULT_PROVIDER: '' },
    });

    expect(mod.providers).not.toHaveProperty('twilio');
    expect(mod.providerName).toBe('mock');

    const prov = mod.getProvider();
    expect(prov).toMatchObject({ providerName: 'mock' });

    // unknown still falls back to mock
    expect(mod.getProvider('nope')).toMatchObject({ providerName: 'mock' });
  });
});

/* -------------------- sendSms (Twilio) -------------------- */

describe('sendSms (Twilio)', () => {
  // helper to create a Twilio SDK mock: returns client with messages.create mock
  const makeTwilioSdkMock = (createImpl = jest.fn().mockResolvedValue({ sid: 'SM123' })) => {
    const createMock = createImpl;
    const sdkFactory = (sid, token) => ({
      messages: {
        create: createMock,
      },
    });
    return { sdkFactory, createMock };
  };

  test('throws when credentials missing (no SID or token)', async () => {
    const { sdkFactory } = makeTwilioSdkMock();
    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: '',
        TWILIO_AUTH_TOKEN: '',
      },
      mockTwilioSdk: sdkFactory,
    });

    await expect(
      mod.sendSms({ to: '+15550001111', text: 'hi' })
    ).rejects.toThrow(/Twilio not configured/i);
  });

  test('uses Messaging Service SID when provided (no "from")', async () => {
    const { sdkFactory, createMock } = makeTwilioSdkMock(jest.fn().mockResolvedValue({ sid: 'SM999' }));

    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: 'AC_x',
        TWILIO_AUTH_TOKEN: 'tok_y',
        TWILIO_MESSAGING_SERVICE_SID: 'MG_123',
        TWILIO_FROM_NUMBER: '+15551112222', // should be ignored when MG provided & no explicit from
      },
      mockTwilioSdk: sdkFactory,
    });

    const res = await mod.sendSms({ to: '+15550001111', text: 'hey' });
    expect(res).toEqual({ provider: 'twilio', messageSid: 'SM999' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15550001111',
        body: 'hey',
        messagingServiceSid: 'MG_123',
      })
    );
    // Ensure 'from' is NOT set in this branch
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('from');
  });

  test('uses explicit "from" if given (ignores Messaging Service)', async () => {
    const { sdkFactory, createMock } = makeTwilioSdkMock(jest.fn().mockResolvedValue({ sid: 'SM321' }));

    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: 'AC_x',
        TWILIO_AUTH_TOKEN: 'tok_y',
        TWILIO_MESSAGING_SERVICE_SID: 'MG_123',   // should be ignored due to explicit from
        TWILIO_FROM_NUMBER: '+15553334444',
      },
      mockTwilioSdk: sdkFactory,
    });

    const res = await mod.sendSms({ to: '+15550002222', from: '+18885551234', text: 'yo' });
    expect(res).toEqual({ provider: 'twilio', messageSid: 'SM321' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15550002222',
        from: '+18885551234',
        body: 'yo',
      })
    );
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('messagingServiceSid');
  });

  test('uses TWILIO_FROM_NUMBER when no Messaging Service and no explicit from', async () => {
    const { sdkFactory, createMock } = makeTwilioSdkMock(jest.fn().mockResolvedValue({ sid: 'SM777' }));

    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: 'AC_x',
        TWILIO_AUTH_TOKEN: 'tok_y',
        TWILIO_MESSAGING_SERVICE_SID: '',          // not provided
        TWILIO_FROM_NUMBER: '+15556667777',        // fallback
      },
      mockTwilioSdk: sdkFactory,
    });

    const res = await mod.sendSms({ to: '+15550003333', text: 'sup' });
    expect(res).toEqual({ provider: 'twilio', messageSid: 'SM777' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15550003333',
        from: '+15556667777',
        body: 'sup',
      })
    );
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('messagingServiceSid');
  });

  test('throws when neither Messaging Service SID nor "from" available', async () => {
    const { sdkFactory } = makeTwilioSdkMock();

    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: 'AC_x',
        TWILIO_AUTH_TOKEN: 'tok_y',
        TWILIO_MESSAGING_SERVICE_SID: '',   // none
        TWILIO_FROM_NUMBER: '',             // none
      },
      mockTwilioSdk: sdkFactory,
    });

    await expect(
      mod.sendSms({ to: '+15550004444', text: 'nope' })
    ).rejects.toThrow(/requires TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER/i);
  });
});

/* -------------------- getProvider() fallback -------------------- */

describe('getProvider() fallback behavior', () => {
  test('unknown key → default; when no adapter present, default is mock', async () => {
    const mod = await reload({
      hasTwilioAdapter: false,
      env: { DEFAULT_PROVIDER: '' },
    });

    const p = mod.getProvider('does-not-exist');
    expect(p).toMatchObject({ providerName: 'mock' });
  });
});
