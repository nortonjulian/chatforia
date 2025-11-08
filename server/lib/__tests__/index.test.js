const ORIGINAL_ENV = process.env;

const reload = async ({
  hasTwilioAdapter = true,
  env = {},
  mockTwilioSdk = null,
} = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // Simulate presence/absence of ./twilio.js adapter (top-level awaited import in index.js)
  if (hasTwilioAdapter) {
    jest.doMock('../twilio.js', () => ({
      __esModule: true,
      default: { providerName: 'twilio' },
    }));
  } else {
    // Simulate failed dynamic import
    jest.doMock('../twilio.js', () => {
      throw new Error('no adapter');
    });
  }

  if (mockTwilioSdk) {
    jest.doMock('twilio', () => mockTwilioSdk);
  }

  // Import the module under test (ESM)
  return import('../index.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('telco/index registry & defaults', () => {
  test('when Twilio adapter is present: registry has twilio; default is twilio unless DEFAULT_PROVIDER set', async () => {
    const mod = await reload({ hasTwilioAdapter: true, env: { DEFAULT_PROVIDER: '' } });

    expect(mod.providers).toBeDefined();
    // Only twilio is registered
    expect(Object.keys(mod.providers)).toEqual(['twilio']);

    // Default export is the default provider instance
    expect(typeof mod.default).toBe('object'); // adapter object
    expect(mod.providerName).toBe('twilio');

    // getProvider returns twilio if asked; unknown keys fall back to default (twilio)
    expect(mod.getProvider('twilio')).toBeDefined();
    expect(mod.getProvider('unknown')).toBe(mod.getProvider('twilio'));
  });

  test('DEFAULT_PROVIDER respected when twilio is present', async () => {
    const mod = await reload({
      hasTwilioAdapter: true,
      env: { DEFAULT_PROVIDER: 'twilio' },
    });

    expect(mod.providerName).toBe('twilio');
    expect(mod.getProvider(null)).toBeDefined();
  });

  test('when Twilio adapter is missing: providers empty; default & providerName are mock', async () => {
    const mod = await reload({ hasTwilioAdapter: false, env: { DEFAULT_PROVIDER: '' } });

    expect(mod.providers).toEqual({});
    expect(mod.providerName).toBe('mock');

    const mockProv = mod.getProvider(); // default (mock) returned
    expect(mockProv).toBeDefined();
    expect(typeof mockProv.searchAvailable).toBe('function');

    // unknown provider still returns mock
    expect(mod.getProvider('twilio')).toBe(mockProv);
    expect(mod.default).toBe(mockProv);
  });
});

describe('sendSms (Twilio)', () => {
  const makeTwilioSdkMock = (createImpl = jest.fn().mockResolvedValue({ sid: 'SM123' })) => {
    const createMock = createImpl;
    const sdkFactory = (sid, token) => ({
      messages: {
        create: createMock,
      },
    });

    // "default" may be a function or module default; index.js handles both
    return {
      __esModule: true,
      default: sdkFactory,
    };
  };

  test('uses Messaging Service SID when provided (no "from")', async () => {
    const createMock = jest.fn().mockResolvedValue({ sid: 'SM999' });
    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: 'ACxxx',
        TWILIO_AUTH_TOKEN: 'tok',
        TWILIO_MESSAGING_SERVICE_SID: 'MExxx',
        TWILIO_STATUS_CALLBACK_URL: 'https://cb.example.com/hook',
        TWILIO_FROM_NUMBER: '', // not needed
      },
      mockTwilioSdk: makeTwilioSdkMock(createMock),
    });

    const out = await mod.sendSms({
      to: '+15551234567',
      text: 'hello',
      // no from
      clientRef: 'abc-123', // not sent to Twilio, just here to ensure no error
    });

    expect(out).toEqual({ provider: 'twilio', messageSid: 'SM999' });
    expect(createMock).toHaveBeenCalledWith({
      to: '+15551234567',
      body: 'hello',
      messagingServiceSid: 'MExxx',
      statusCallback: 'https://cb.example.com/hook',
    });
  });

  test('uses explicit "from" if given (ignores Messaging Service)', async () => {
    const createMock = jest.fn().mockResolvedValue({ sid: 'SM321' });
    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: 'ACxxx',
        TWILIO_AUTH_TOKEN: 'tok',
        TWILIO_MESSAGING_SERVICE_SID: 'MExxx', // present but should be ignored because we pass from
        TWILIO_STATUS_CALLBACK_URL: '',
      },
      mockTwilioSdk: makeTwilioSdkMock(createMock),
    });

    const out = await mod.sendSms({
      to: '+15550000000',
      from: '+15551112222',
      text: 'hey',
    });

    expect(out).toEqual({ provider: 'twilio', messageSid: 'SM321' });
    expect(createMock).toHaveBeenCalledWith({
      to: '+15550000000',
      body: 'hey',
      from: '+15551112222',
    });
  });

  test('uses TWILIO_FROM_NUMBER when no Messaging Service and no explicit from', async () => {
    const createMock = jest.fn().mockResolvedValue({ sid: 'SM777' });
    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: 'ACxxx',
        TWILIO_AUTH_TOKEN: 'tok',
        TWILIO_FROM_NUMBER: '+18005551234',
      },
      mockTwilioSdk: makeTwilioSdkMock(createMock),
    });

    const out = await mod.sendSms({
      to: '+14155550123',
      text: 'ping',
    });

    expect(out).toEqual({ provider: 'twilio', messageSid: 'SM777' });
    expect(createMock).toHaveBeenCalledWith({
      to: '+14155550123',
      body: 'ping',
      from: '+18005551234',
    });
  });

  test('throws when credentials missing (no SID or token)', async () => {
    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: '', // missing
        TWILIO_AUTH_TOKEN: 'tok',
      },
      mockTwilioSdk: makeTwilioSdkMock(),
    });

    await expect(
      mod.sendSms({ to: '+1', text: 'x' })
    ).rejects.toThrow('Twilio not configured');
  });

  test('throws when neither Messaging Service SID nor "from" available', async () => {
    const mod = await reload({
      hasTwilioAdapter: true,
      env: {
        TWILIO_ACCOUNT_SID: 'ACxxx',
        TWILIO_AUTH_TOKEN: 'tok',
        TWILIO_MESSAGING_SERVICE_SID: '', // missing
        TWILIO_FROM_NUMBER: '', // missing
      },
      mockTwilioSdk: makeTwilioSdkMock(),
    });

    await expect(
      mod.sendSms({ to: '+1', text: 'x' })
    ).rejects.toThrow(
      'Twilio messaging requires TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER'
    );
  });
});

describe('getProvider() fallback behavior', () => {
  test('unknown key → default; when no adapter present, default is mock', async () => {
    const mod = await reload({ hasTwilioAdapter: false });

    const prov = mod.getProvider('does-not-exist');
    // mock adapter behavior: searchAvailable resolves {items: []}, purchaseNumber throws
    await expect(prov.searchAvailable({})).resolves.toEqual({ items: [] });
    await expect(prov.purchaseNumber({})).rejects.toThrow('Mock provider cannot purchase numbers');
  });
});
