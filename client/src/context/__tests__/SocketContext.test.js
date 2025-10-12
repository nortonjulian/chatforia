import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';

// ---- Mocks ----
const listeners = new Map();
const mockSocket = {
  connected: false,
  on: (ev, cb) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(cb);
  },
  off: (ev, cb) => {
    if (listeners.has(ev)) listeners.get(ev).delete(cb);
  },
  emit: jest.fn(),
  disconnect: jest.fn(function () {
    mockSocket.connected = false;
  }),
};

// Allow creating a fresh socket per makeSocket() call
const ioMock = jest.fn(() => {
  // reset per-instance state
  mockSocket.connected = true; // act like we connect immediately
  return mockSocket;
});
jest.mock('socket.io-client', () => ({ __esModule: true, io: (...args) => ioMock(...args) }));

// js-cookie
const cookieGetMock = jest.fn();
jest.mock('js-cookie', () => ({ __esModule: true, default: { get: (...a) => cookieGetMock(...a) } }));

// axios client (GET only used here)
const axiosGetMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...a) => axiosGetMock(...a) },
}));

// SUT
import { SocketProvider, useSocket } from './SocketContext';

// Harness to capture context
let ctxRef;
function Harness() {
  const ctx = useSocket();
  useEffect(() => { ctxRef = ctx; });
  return null;
}

function renderWithProvider(props = {}) {
  ctxRef = null;
  listeners.clear();
  ioMock.mockClear();
  mockSocket.emit.mockClear();
  mockSocket.disconnect.mockClear();
  axiosGetMock.mockReset();
  cookieGetMock.mockReset();

  return render(
    <SocketProvider {...props}>
      <Harness />
    </SocketProvider>
  );
}

// Helpers
const setAuthed = (token = 'jwt-123', cookieName = 'foria_jwt') => {
  cookieGetMock.mockImplementation((name) => (name === cookieName ? token : undefined));
  // also backstop localStorage and document.cookie
  window.localStorage.setItem(cookieName, token);
  Object.defineProperty(document, 'cookie', {
    value: `${cookieName}=${token}`,
    writable: true,
    configurable: true,
  });
};
const clearAuth = (cookieName = 'foria_jwt') => {
  cookieGetMock.mockReturnValue(undefined);
  window.localStorage.removeItem(cookieName);
  Object.defineProperty(document, 'cookie', { value: '', writable: true, configurable: true });
};

// Trigger a socket event
const emit = (ev, payload) => {
  if (!listeners.has(ev)) return;
  for (const cb of listeners.get(ev)) cb(payload);
};

beforeEach(() => {
  // default: authed
  setAuthed();
  // default axios candidates: first 404, second returns items
  axiosGetMock
    .mockRejectedValueOnce({ response: { status: 404 } }) // /chatrooms/mine
    .mockResolvedValueOnce({ data: { items: [{ id: 1 }, { id: '2' }] } }); // /rooms/mine
});

describe('SocketContext', () => {
  test('does not connect without auth', () => {
    clearAuth();
    renderWithProvider();
    expect(ioMock).not.toHaveBeenCalled();
    expect(ctxRef.socket).toBeNull();
  });

  test('connects when auth is present and sets socket instance', () => {
    renderWithProvider();
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ctxRef.socket).toBeTruthy();
  });

  test('auto-joins rooms on connect: refreshRooms tries candidates and emits join:rooms', async () => {
    renderWithProvider(); // autoJoin default true

    // Simulate socket 'connect' (our mock marks connected=true immediately, but we still emit)
    await act(async () => {
      emit('connect');
    });

    // It should have tried first 404 route then succeeded on second
    expect(axiosGetMock).toHaveBeenCalledWith('/chatrooms/mine?select=id');
    expect(axiosGetMock).toHaveBeenCalledWith('/rooms/mine?select=id');

    // Should emit join:rooms with ['1','2']
    expect(mockSocket.emit).toHaveBeenCalledWith('join:rooms', ['1', '2']);
  });

  test('non-autojoin mode: does not emit join:rooms automatically', async () => {
    renderWithProvider({ autoJoin: false });

    await act(async () => { emit('connect'); });

    expect(mockSocket.emit).not.toHaveBeenCalledWith('join:rooms', expect.any(Array));
  });

  test('refreshRooms handles 401 by clearing roomIds and returning []', async () => {
    axiosGetMock.mockReset().mockRejectedValueOnce({ response: { status: 401 } });
    renderWithProvider();

    let ids;
    await act(async () => {
      ids = await ctxRef.refreshRooms();
    });

    expect(ids).toEqual([]);
    expect(mockSocket.emit).not.toHaveBeenCalledWith('join:rooms', expect.anything());
  });

  test('refreshRooms ignores 404s and continues, finally returns [] if all fail/404', async () => {
    axiosGetMock
      .mockReset()
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce({ response: { status: 404 } });

    renderWithProvider();

    let ids;
    await act(async () => {
      ids = await ctxRef.refreshRooms();
    });

    expect(axiosGetMock).toHaveBeenCalledTimes(3);
    expect(ids).toEqual([]);
  });

  test('disconnect clears socket state; reconnect calls disconnect then connect', () => {
    renderWithProvider();

    // disconnect
    act(() => ctxRef.disconnect());
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(ctxRef.socket).toBeNull();

    // reconnect
    act(() => ctxRef.reconnect());
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1); // not called again during reconnect (we already cleared)
    expect(ioMock).toHaveBeenCalledTimes(2); // initial connect + reconnect
    expect(ctxRef.socket).toBeTruthy();
  });

  test('storage event for token triggers reconnect', () => {
    renderWithProvider();
    const connectsBefore = ioMock.mock.calls.length;

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'foria_jwt', newValue: 'jwt-NEW' }));
    });

    // disconnect then connect
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(ioMock.mock.calls.length).toBe(connectsBefore + 1);
  });

  test('joinRooms/leaveRoom helpers emit with normalized strings', () => {
    renderWithProvider();

    act(() => ctxRef.joinRooms([1, '2', 3]));
    expect(mockSocket.emit).toHaveBeenCalledWith('join:rooms', ['1', '2', '3']);

    act(() => ctxRef.leaveRoom(99));
    expect(mockSocket.emit).toHaveBeenCalledWith('leave_room', '99');
  });
});
