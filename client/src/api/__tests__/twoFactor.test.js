import axiosClient from '../axiosClient';
import {
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
} from '../twoFactor';

jest.mock('../axiosClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('two-factor API helper', () => {
  test('starts enrollment using the authenticated API client', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: {
        ok: true,
        tmpSecret: 'TEST-SECRET',
        qrDataUrl: 'data:image/png;base64,abc',
      },
    });

    await expect(setupTwoFactor()).resolves.toEqual({
      tmpSecret: 'TEST-SECRET',
      qrDataUrl: 'data:image/png;base64,abc',
    });

    expect(axiosClient.post).toHaveBeenCalledWith('/auth/2fa/setup');
  });

  test('rejects incomplete setup responses', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: { ok: false },
    });

    await expect(setupTwoFactor()).rejects.toThrow(
      'Could not start two-factor authentication setup.'
    );
  });

  test('enables MFA and returns backup codes without storing JWT', async () => {
    const storageSpy = jest.spyOn(Storage.prototype, 'setItem');

    try {
      axiosClient.post.mockResolvedValueOnce({
        data: {
          ok: true,
          backupCodes: ['TEST-CODE-ONE'],
          token: 'test-jwt-do-not-store',
        },
      });

      await expect(
        enableTwoFactor('TEST-SECRET', '123456')
      ).resolves.toEqual({
        backupCodes: ['TEST-CODE-ONE'],
      });

      expect(axiosClient.post).toHaveBeenCalledWith(
        '/auth/2fa/enable',
        {
          tmpSecret: 'TEST-SECRET',
          code: '123456',
        }
      );

      expect(storageSpy).not.toHaveBeenCalled();
    } finally {
      storageSpy.mockRestore();
    }
  });

  test.each(['12345', '1234567', 'abcdef', '123 456'])(
    'rejects invalid enrollment code %s',
    async (code) => {
      await expect(
        enableTwoFactor('TEST-SECRET', code)
      ).rejects.toThrow('Enter a valid six-digit authenticator code.');

      expect(axiosClient.post).not.toHaveBeenCalled();
    }
  );

  test('rejects enrollment without a temporary secret', async () => {
    await expect(
      enableTwoFactor('', '123456')
    ).rejects.toThrow('Enter a valid six-digit authenticator code.');

    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  test('does not claim success when enrollment fails', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: { ok: false },
    });

    await expect(
      enableTwoFactor('TEST-SECRET', '123456')
    ).rejects.toThrow('Could not enable two-factor authentication.');
  });

  test('rejects empty recovery-code responses', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: {
        ok: true,
        backupCodes: [],
      },
    });

    await expect(
      enableTwoFactor('TEST-SECRET', '123456')
    ).rejects.toThrow(
      'Check your account security status before retrying.'
    );
  });

  test('rejects malformed recovery-code responses', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: {
        ok: true,
        backupCodes: ['VALID-CODE', null],
      },
    });

    await expect(
      enableTwoFactor('TEST-SECRET', '123456')
    ).rejects.toThrow(
      'Check your account security status before retrying.'
    );
  });

  test('does not persist JWT after disabling MFA', async () => {
    const storageSpy = jest.spyOn(Storage.prototype, 'setItem');

    try {
      axiosClient.post.mockResolvedValueOnce({
        data: {
          ok: true,
          token: 'test-jwt-do-not-store',
        },
      });

      await expect(disableTwoFactor('123456'))
        .resolves.toBe(true);

      expect(storageSpy).not.toHaveBeenCalled();
    } finally {
      storageSpy.mockRestore();
    }
  });

  test('disables MFA with a valid authenticator code', async () => {
    axiosClient.post.mockResolvedValueOnce({
      data: { ok: true, token: 'test-jwt' },
    });

    await expect(disableTwoFactor('000000')).resolves.toBe(true);

    expect(axiosClient.post).toHaveBeenCalledWith(
      '/auth/2fa/disable',
      { code: '000000' }
    );
  });

  test('rejects invalid disable codes without contacting the server', async () => {
    await expect(disableTwoFactor('12345')).rejects.toThrow(
      'Enter a valid six-digit authenticator code.'
    );

    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  test('propagates backend failures', async () => {
    axiosClient.post.mockRejectedValueOnce(
      new Error('Network unavailable')
    );

    await expect(setupTwoFactor()).rejects.toThrow(
      'Network unavailable'
    );
  });
});
