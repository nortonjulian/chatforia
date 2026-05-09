/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

const twilioMock = jest.fn();

jest.unstable_mockModule('twilio', () => ({
  __esModule: true,
  default: twilioMock,
}));

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
    twilioMock.mockReturnValue(mockClient);

    const { default: twilioClient } = await import('../twilioClient.js');

    expect(twilioMock).toHaveBeenCalledTimes(1);
    expect(twilioMock).toHaveBeenCalledWith('AC123', 'SECRET');
    expect(twilioClient).toBe(mockClient);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('exports null and logs a warning when credentials are missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;

    const { default: twilioClient } = await import('../twilioClient.js');

    expect(twilioMock).not.toHaveBeenCalled();
    expect(twilioClient).toBeNull();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(
      'Twilio credentials are not set – porting and telephony will not work.'
    );
  });
});