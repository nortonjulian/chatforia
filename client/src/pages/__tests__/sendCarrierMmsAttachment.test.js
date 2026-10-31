import { sendCarrierMmsAttachment } from '../sendCarrierMmsAttachment.js';

describe('carrier MMS attachment submission', () => {
  const privateKey = 'uploads/u42/photos/sunset.jpg';
  let axiosClient;

  beforeEach(() => {
    axiosClient = {
      post: jest.fn().mockResolvedValue({
        data: { ok: true },
      }),
    };
  });

  test('submits a completed image using its private key', async () => {
    await sendCarrierMmsAttachment({
      axiosClient,
      toNumber: '+15551234567',
      text: '',
      fileMeta: {
        key: privateKey,
        url: 'https://cdn.example.test/sunset.jpg',
        contentType: 'image/jpeg',
      },
    });

    expect(axiosClient.post).toHaveBeenCalledTimes(1);
    expect(axiosClient.post).toHaveBeenCalledWith(
      '/sms/send',
      {
        to: '+15551234567',
        body: '',
        mediaUrls: [privateKey],
      }
    );
  });

  test('includes the message caption', async () => {
    await sendCarrierMmsAttachment({
      axiosClient,
      toNumber: '+15551234567',
      text: 'Beach sunset',
      fileMeta: { key: privateKey },
    });

    expect(axiosClient.post).toHaveBeenCalledWith(
      '/sms/send',
      {
        to: '+15551234567',
        body: 'Beach sunset',
        mediaUrls: [privateKey],
      }
    );
  });

  test('preserves existing URL fallback behavior', async () => {
    await sendCarrierMmsAttachment({
      axiosClient,
      toNumber: '+15551234567',
      fileMeta: { url: privateKey },
    });

    expect(axiosClient.post).toHaveBeenCalledWith(
      '/sms/send',
      {
        to: '+15551234567',
        body: '',
        mediaUrls: [privateKey],
      }
    );
  });

  test('rejects missing recipient without sending', async () => {
    await expect(sendCarrierMmsAttachment({
      axiosClient,
      toNumber: '',
      fileMeta: { key: privateKey },
    })).rejects.toThrow('Missing MMS recipient');

    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  test('rejects missing media without sending', async () => {
    await expect(sendCarrierMmsAttachment({
      axiosClient,
      toNumber: '+15551234567',
      fileMeta: {},
    })).rejects.toThrow('Missing MMS recipient');

    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  test('propagates failure for composer retry handling', async () => {
    axiosClient.post.mockRejectedValueOnce(
      new Error('Carrier submission failed')
    );

    await expect(sendCarrierMmsAttachment({
      axiosClient,
      toNumber: '+15551234567',
      fileMeta: { key: privateKey },
    })).rejects.toThrow('Carrier submission failed');

    expect(axiosClient.post).toHaveBeenCalledTimes(1);
  });
});
