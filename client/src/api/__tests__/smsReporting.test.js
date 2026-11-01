import { submitSmsMessageReport } from '../smsReporting';
import axiosClient from '../axiosClient';

jest.mock('../axiosClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('submitSmsMessageReport', () => {
  test('sends the exact reporting payload with zero context', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        report: {
          id: 101,
          blockApplied: false,
        },
      },
    });

    const report = await submitSmsMessageReport(42, {
      reason: 'spam_scam',
      details: 'Suspicious link',
      contextCount: 0,
      blockAfterReport: false,
    });

    expect(axiosClient.post).toHaveBeenCalledWith(
      '/sms/messages/42/report',
      {
        reason: 'spam_scam',
        details: 'Suspicious link',
        contextCount: 0,
        blockAfterReport: false,
      }
    );

    expect(report.id).toBe(101);
    expect(report.blockApplied).toBe(false);
  });

  test('sends optional blocking only when selected', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        report: {
          id: 102,
          blockApplied: true,
        },
      },
    });

    await submitSmsMessageReport(42, {
      reason: 'harassment',
      details: '',
      contextCount: 5,
      blockAfterReport: true,
    });

    expect(axiosClient.post).toHaveBeenCalledWith(
      '/sms/messages/42/report',
      expect.objectContaining({
        contextCount: 5,
        blockAfterReport: true,
      })
    );
  });

  test('rejects invalid message IDs without calling the API', async () => {
    await expect(
      submitSmsMessageReport(0, {
        reason: 'other',
      })
    ).rejects.toThrow('Valid SMS message ID required.');

    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  test('rejects responses without server confirmation', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: {
        success: false,
      },
    });

    await expect(
      submitSmsMessageReport(42, {
        reason: 'spam_scam',
        contextCount: 0,
        blockAfterReport: false,
      })
    ).rejects.toThrow('The server did not confirm your report.');
  });

  test('propagates duplicate-report errors', async () => {
    const error = {
      response: {
        status: 409,
        data: {
          message: 'You already reported this message',
        },
      },
    };

    axiosClient.post.mockRejectedValueOnce(error);

    await expect(
      submitSmsMessageReport(42, {
        reason: 'spam_scam',
        contextCount: 0,
        blockAfterReport: false,
      })
    ).rejects.toBe(error);
  });

  test('propagates server failures without claiming success', async () => {
    const error = new Error('Network unavailable');

    axiosClient.post.mockRejectedValueOnce(error);

    await expect(
      submitSmsMessageReport(42, {
        reason: 'other',
        contextCount: 0,
        blockAfterReport: false,
      })
    ).rejects.toThrow('Network unavailable');
  });
});
