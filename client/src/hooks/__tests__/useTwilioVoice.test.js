import { act, renderHook } from '@testing-library/react';
import { useTwilioVoice } from '../useTwilioVoice';
import { fetchVoiceToken } from '@/api/voiceClientApi';

const mockDevices = [];

jest.mock('@/api/voiceClientApi', () => ({
  fetchVoiceToken: jest.fn(),
}));

jest.mock('@/utils/safeToast', () => ({
  toast: {
    ok: jest.fn(),
    err: jest.fn(),
  },
}));

jest.mock('@twilio/voice-sdk', () => ({
  Device: jest.fn().mockImplementation(() => {
    const listeners = new Map();

    const device = {
      on: jest.fn((event, listener) => {
        listeners.set(event, listener);
      }),
      register: jest.fn(async () => {
        listeners.get('registered')?.();
      }),
      connect: jest.fn(async () => ({
        on: jest.fn(),
      })),
      updateToken: jest.fn(),
      disconnectAll: jest.fn(),
      destroy: jest.fn(),
      emit: (event, ...args) => {
        listeners.get(event)?.(...args);
      },
    };

    mockDevices.push(device);
    return device;
  }),
}));

describe('useTwilioVoice token refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDevices.length = 0;
  });

  it('refreshes the existing Device when its token will expire', async () => {
    fetchVoiceToken
      .mockResolvedValueOnce({
        token: 'initial-token',
        identity: 'user_1',
      })
      .mockResolvedValueOnce({
        token: 'replacement-token',
        identity: 'user_1',
      });

    const { result, unmount } = renderHook(() =>
      useTwilioVoice()
    );

    await act(async () => {
      await result.current.startBrowserCall('24', {
        backendCallId: 823,
      });
    });

    const device = mockDevices[0];

    await act(async () => {
      device.emit('tokenWillExpire');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchVoiceToken).toHaveBeenCalledTimes(2);
    expect(device.updateToken).toHaveBeenCalledTimes(1);
    expect(device.updateToken).toHaveBeenCalledWith(
      'replacement-token'
    );

    unmount();
  });

  it('deduplicates simultaneous token refresh events', async () => {
    let resolveRefresh;

    fetchVoiceToken
      .mockResolvedValueOnce({
        token: 'initial-token',
        identity: 'user_1',
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          })
      );

    const { result, unmount } = renderHook(() =>
      useTwilioVoice()
    );

    await act(async () => {
      await result.current.startBrowserCall('24');
    });

    const device = mockDevices[0];

    act(() => {
      device.emit('tokenWillExpire');
      device.emit('tokenWillExpire');
    });

    expect(fetchVoiceToken).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh({
        token: 'replacement-token',
        identity: 'user_1',
      });
      await Promise.resolve();
    });

    expect(device.updateToken).toHaveBeenCalledTimes(1);
    expect(device.updateToken).toHaveBeenCalledWith(
      'replacement-token'
    );

    unmount();
  });

  it('does not update a Device destroyed during refresh', async () => {
    let resolveRefresh;

    fetchVoiceToken
      .mockResolvedValueOnce({
        token: 'initial-token',
        identity: 'user_1',
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          })
      );

    const { result, unmount } = renderHook(() =>
      useTwilioVoice()
    );

    await act(async () => {
      await result.current.startBrowserCall('24');
    });

    const device = mockDevices[0];

    act(() => {
      device.emit('tokenWillExpire');
    });

    unmount();

    await act(async () => {
      resolveRefresh({
        token: 'replacement-token',
        identity: 'user_1',
      });
      await Promise.resolve();
    });

    expect(device.destroy).toHaveBeenCalledTimes(1);
    expect(device.updateToken).not.toHaveBeenCalled();
  });
});
