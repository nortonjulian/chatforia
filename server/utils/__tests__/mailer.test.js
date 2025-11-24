import { jest } from '@jest/globals';

const mockSendMail = jest.fn();

jest.mock('../../services/mailer.js', () => ({
  __esModule: true,
  transporter: {
    sendMail: mockSendMail,
  },
}));

import { sendMail } from '../mailer.js';

describe('sendMail (utils/mailer)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV }; // shallow copy
    delete process.env.MAIL_FROM;
    delete process.env.SMTP_FROM;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('uses MAIL_FROM when set', async () => {
    process.env.MAIL_FROM = 'from@mailfrom.test';

    await sendMail({
      to: 'user@example.com',
      subject: 'Test subject',
      text: 'Hello text',
      html: '<p>Hello HTML</p>',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'from@mailfrom.test',
      to: 'user@example.com',
      subject: 'Test subject',
      text: 'Hello text',
      html: '<p>Hello HTML</p>',
    });
  });

  test('falls back to SMTP_FROM when MAIL_FROM is not set', async () => {
    process.env.SMTP_FROM = 'from@smtpfrom.test';

    await sendMail({
      to: ['user1@example.com', 'user2@example.com'],
      subject: 'Another subject',
      text: 'Body text',
      html: '<p>Body HTML</p>',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'from@smtpfrom.test',
      to: ['user1@example.com', 'user2@example.com'],
      subject: 'Another subject',
      text: 'Body text',
      html: '<p>Body HTML</p>',
    });
  });

  test('uses default from when neither MAIL_FROM nor SMTP_FROM is set', async () => {
    await sendMail({
      to: 'user@example.com',
      subject: 'Default from subject',
      text: 'Default from text',
      html: '<p>Default from HTML</p>',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'no-reply@chatforia.com',
      to: 'user@example.com',
      subject: 'Default from subject',
      text: 'Default from text',
      html: '<p>Default from HTML</p>',
    });
  });
});
