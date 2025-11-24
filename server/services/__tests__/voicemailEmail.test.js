/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

import logger from '../../utils/logger.js';
import { sendMail } from '../utils/mailer.js';
import { sendVoicemailForwardEmail } from '../voicemailEmail.js';

describe('sendVoicemailForwardEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns early and logs warn when toEmail is missing', async () => {
    await sendVoicemailForwardEmail({
      toEmail: null,
      fromNumber: '+15551234567',
      toNumber: '+15557654321',
      transcript: 'Test transcript',
      audioUrl: 'https://example.com/vm.mp3',
      durationSec: 30,
      createdAt: new Date().toISOString(),
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { toEmail: null },
      'No toEmail provided for voicemail forward'
    );
  });

  test('sends email with correct fields and logs info on success', async () => {
    const createdAt = '2024-01-01T12:00:00.000Z';

    await sendVoicemailForwardEmail({
      toEmail: 'user@example.com',
      fromNumber: '+15551234567',
      toNumber: '+15557654321',
      transcript: 'Hello <b>world</b>',
      audioUrl: 'https://example.com/vm.mp3',
      durationSec: 42,
      createdAt,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);

    const callArg = sendMail.mock.calls[0][0];
    expect(callArg.to).toBe('user@example.com');
    expect(callArg.subject).toBe('New voicemail from +15551234567');

    expect(callArg.text).toContain('You have a new voicemail in Chatforia.');
    expect(callArg.text).toContain('From: +15551234567');
    expect(callArg.text).toContain('To:   +15557654321');
    expect(callArg.text).toContain('Duration: 42s');
    expect(callArg.text).toContain('Transcript:');
    expect(callArg.text).toContain('Hello <b>world</b>');
    expect(callArg.text).toContain('https://example.com/vm.mp3');

    expect(callArg.html).toContain('<strong>Transcript:</strong>');
    expect(callArg.html).toContain('&lt;b&gt;world&lt;/b&gt;');
    expect(callArg.html).not.toContain('<b>world</b>');
    expect(callArg.html).toContain('https://example.com/vm.mp3');
    expect(callArg.html).toContain('Listen to voicemail');

    expect(logger.info).toHaveBeenCalledWith(
      { toEmail: 'user@example.com' },
      'Voicemail forward email sent'
    );
  });

  test('uses "Unknown caller" when fromNumber is missing', async () => {
    await sendVoicemailForwardEmail({
      toEmail: 'user@example.com',
      fromNumber: null,
      toNumber: '+15557654321',
      transcript: '',
      audioUrl: '',
      durationSec: null,
      createdAt: null,
    });

    const callArg = sendMail.mock.calls[0][0];
    expect(callArg.subject).toBe('New voicemail from Unknown caller');
    expect(callArg.text).toContain('From: Unknown caller');
    expect(callArg.html).toContain('Unknown caller');
  });

  test('logs error when sendMail throws', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP failed'));

    await sendVoicemailForwardEmail({
      toEmail: 'user@example.com',
      fromNumber: '+15551234567',
      toNumber: '+15557654321',
      transcript: 'Hi',
      audioUrl: 'https://example.com/vm.mp3',
      durationSec: 10,
      createdAt: new Date().toISOString(),
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();

    const [errorPayload, message] = logger.error.mock.calls[0];
    expect(errorPayload).toHaveProperty('err');
    expect(errorPayload).toHaveProperty('toEmail', 'user@example.com');
    expect(message).toBe('Failed to send voicemail forward email');
  });
});
