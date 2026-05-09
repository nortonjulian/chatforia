import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

async function loadModuleWithMocks({ sendSucceeds = true } = {}) {
  jest.resetModules();

  process.env.RESEND_API_KEY = 're_test_123';
  process.env.EMAIL_FROM = 'Chatforia <support@chatforia.test>';

  const emailsSendMock = jest.fn();

  if (sendSucceeds) {
    emailsSendMock.mockResolvedValue({
      data: {
        id: 'email_abc123',
      },
      error: null,
    });
  } else {
    emailsSendMock.mockResolvedValue({
      data: null,
      error: new Error('SMTP failed'),
    });
  }

  const ResendMock = jest.fn(() => ({
    emails: {
      send: emailsSendMock,
    },
  }));

  await jest.unstable_mockModule('resend', () => ({
    __esModule: true,
    Resend: ResendMock,
  }));

  const mod = await import('../../utils/sendMail.js');

  return {
    sendMail: mod.sendMail,
    isEmailAvailable: mod.isEmailAvailable,
    sendTransactionalEmail: mod.sendTransactionalEmail,
    ResendMock,
    emailsSendMock,
  };
}

describe('sendMail()', () => {
  test('sends email and returns success data', async () => {
    const { sendMail, ResendMock, emailsSendMock } =
      await loadModuleWithMocks({ sendSucceeds: true });

    const result = await sendMail({
      to: 'user@example.com',
      subject: 'Reset your password',
      html: '<p>Click here</p>',
      text: 'Click here',
      replyTo: 'support@chatforia.test',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'email_abc123',
    });

    expect(ResendMock).toHaveBeenCalledWith('re_test_123');

    expect(emailsSendMock).toHaveBeenCalledTimes(1);
    expect(emailsSendMock).toHaveBeenCalledWith({
      from: 'Chatforia <support@chatforia.test>',
      to: 'user@example.com',
      subject: 'Reset your password',
      html: '<p>Click here</p>',
      text: 'Click here',
      reply_to: 'support@chatforia.test',
      attachments: undefined,
    });
  });

  test('returns { success:false, error } if Resend returns error', async () => {
    const { sendMail, emailsSendMock } =
      await loadModuleWithMocks({ sendSucceeds: false });

    const result = await sendMail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<b>yo</b>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe('SMTP failed');

    expect(emailsSendMock).toHaveBeenCalledTimes(1);
  });

  test('returns unavailable when RESEND_API_KEY is missing', async () => {
    jest.resetModules();

    delete process.env.RESEND_API_KEY;

    await jest.unstable_mockModule('resend', () => ({
      __esModule: true,
      Resend: jest.fn(),
    }));

    const { sendMail, isEmailAvailable } = await import('../../utils/sendMail.js');

    expect(isEmailAvailable()).toBe(false);

    const result = await sendMail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<b>yo</b>',
    });

    expect(result.success).toBe(false);
    expect(result.error.message).toBe('RESEND_API_KEY is missing');
  });
});