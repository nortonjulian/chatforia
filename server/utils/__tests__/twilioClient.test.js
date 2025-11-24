import twilio from 'twilio';

jest.mock('twilio', () => jest.fn());

const ORIGINAL_ENV = process.env;

describe('twilioClient util', () => {
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    warnSpy.mockRestore();
  });

  test('creates a twilio client when credentials are set', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'SECRET';

    const mockClient = { foo: 'bar' };
    twilio.mockReturnValue(mockClient);

    const { default: twilioClient } = await import('./twilioClient.js');

    // Should have created the client
    expect(twilio).toHaveBeenCalledTimes(1);
    expect(twilio).toHaveBeenCalledWith('AC123', 'SECRET');
    expect(twilioClient).toBe(mockClient);

    // No warning when creds exist
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('exports null and logs a warning when credentials are missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;

    const { default: twilioClient } = await import('./twilioClient.js');

    // No client created
    expect(twilio).not.toHaveBeenCalled();
    expect(twilioClient).toBeNull();

    // Warning logged
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(
      'Twilio credentials are not set – porting and telephony will not work.'
    );
  });
});
