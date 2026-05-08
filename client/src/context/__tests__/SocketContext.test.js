import { useEffect } from 'react';
import { render, act, waitFor } from '@testing-library/react';

// ---- Mocks ----
const listeners = new Map();

const mockSocket = {
  connected: false,
  active: false,
  auth: {},
  on: (ev, cb) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(cb);
  },
  off: (ev, cb) => {
    if (listeners.has(ev)) listeners.get(ev).delete(cb);
  },
  once: jest.fn(),
  connect: jest.fn(function () {
    mockSocket.connected = true;
    mockSocket.active = true;
  }),
  emit: jest.fn(),
  disconnect: jest.fn(function () {
    mockSocket.connected = false;
    mockSocket.active = false;
  }),
};

const mockIo = jest.fn(() => {
  mockSocket.connected = true;
  mockSocket.active = true;
  return mockSocket;
});

jest.mock('socket.io-client', () => ({
  __esModule: true,
  io: (...args) => mockIo(...args),
}));

const mockCookieGet = jest.fn();

jest.mock('js-cookie', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockCookieGet(...args),
  },
}));

const mockAxiosGet = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockAxiosGet(...args),
  },
}));

jest.mock('@/config', () => ({
  __esModule: true,
  API_BASE_URL: 'http://localhost:5002',
}));

// ---- SUT ----
import { SocketProvider, useSocket } from '../SocketContext';

let ctxRef;

function Harness() {
  const ctx = useSocket();

  useEffect(() => {
    ctxRef = ctx;
  }, [ctx]);

  return null;
}

function renderWithProvider(props = {}) {
  ctxRef = null;
  listeners.clear();

  mockIo.mockClear();
  mockSocket.emit.mockClear();
  mockSocket.disconnect.mockClear();
  mockSocket.connect.mockClear();
  mockSocket.once.mockClear();

  mockSocket.connected = false;
  mockSocket.active = false;
  mockSocket.auth = {};

  return render(
    <SocketProvider {...props}>
      <Harness />
    </SocketProvider>
  );
}

function setAuthed(token = 'jwt-123', cookieName = 'foria_jwt') {
  mockCookieGet.mockImplementation((name) =>
    name === cookieName ? token : undefined
  );

  window.localStorage.setItem(cookieName, token);
  window.localStorage.setItem('token', token);

  Object.defineProperty(document, 'cookie', {
    value: `${cookieName}=${token}`,
    writable: true,
    configurable: true,
  });
}

function clearAuth(cookieName = 'foria_jwt') {
  mockCookieGet.mockReturnValue(undefined);

  window.localStorage.removeItem(cookieName);
  window.localStorage.removeItem('token');

  Object.defineProperty(document, 'cookie', {
    value: '',
    writable: true,
    configurable: true,
  });
}

function emitSocketEvent(ev, payload) {
  if (!listeners.has(ev)) return;

  for (const cb of listeners.get(ev)) {
    cb(payload);
  }
}

beforeEach(() => {
  setAuthed();

  mockAxiosGet.mockReset();
  mockCookieGet.mockClear();

  mockAxiosGet.mockResolvedValue({
    data: {
      items: [],
    },
  });
});

describe('SocketContext', () => {
  test('connect() creates socket even without auth', () => {
    clearAuth();

    renderWithProvider();

    act(() => {
      ctxRef.connect();
    });

    expect(mockIo).toHaveBeenCalledTimes(1);
    expect(ctxRef.socket).toBeTruthy();
  });

  test('connects when connect() is called and auth is present', () => {
    renderWithProvider();

    act(() => {
      ctxRef.connect();
    });

    act(() => {
      ctxRef.connect();
    });

    expect(mockIo).toHaveBeenCalledTimes(1);
    expect(ctxRef.socket).toBeTruthy();
  });

  test('auto-joins rooms on connect: refreshRooms loads /chatrooms and emits join:rooms', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        items: [{ id: 1 }, { id: '2' }],
      },
    });

    renderWithProvider();

    act(() => {
      ctxRef.connect();
    });

    mockSocket.emit.mockClear();

    await act(async () => {
      emitSocketEvent('connect');
    });

    await waitFor(() => {
      expect(mockAxiosGet).toHaveBeenCalledWith('/chatrooms');
    });

    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith('join:rooms', ['1', '2']);
    });
  });

  test('non-autojoin mode: does not emit join:rooms automatically', async () => {
    renderWithProvider({ autoJoin: false });

    act(() => {
      ctxRef.connect();
    });

    await act(async () => {
      emitSocketEvent('connect');
    });

    expect(mockSocket.emit).not.toHaveBeenCalledWith(
      'join:rooms',
      expect.any(Array)
    );
  });

  test('refreshRooms handles 401 by clearing roomIds and returning []', async () => {
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 401 },
    });

    renderWithProvider({ autoJoin: false });

    let ids;

    await act(async () => {
      ids = await ctxRef.refreshRooms();
    });

    expect(mockAxiosGet).toHaveBeenCalledWith('/chatrooms');
    expect(ids).toEqual([]);
    expect(mockSocket.emit).not.toHaveBeenCalledWith(
      'join:rooms',
      expect.anything()
    );
  });

  test('refreshRooms ignores 404 and returns []', async () => {
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 404 },
    });

    renderWithProvider({ autoJoin: false });

    let ids;

    await act(async () => {
      ids = await ctxRef.refreshRooms();
    });

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockAxiosGet).toHaveBeenCalledWith('/chatrooms');
    expect(ids).toEqual([]);
  });

  test('disconnect clears socket state; reconnect calls connect again', () => {
    renderWithProvider();

    act(() => {
      ctxRef.connect();
    });

    act(() => {
      ctxRef.disconnect();
    });

    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(ctxRef.socket).toBeNull();

    act(() => {
      ctxRef.reconnect();
    });

    expect(mockIo).toHaveBeenCalledTimes(2);
    expect(ctxRef.socket).toBeTruthy();
  });

  test('storage event for token triggers reconnect', () => {
    renderWithProvider();

    act(() => {
      ctxRef.connect();
    });

    mockSocket.connect.mockClear();

    setAuthed('jwt-NEW');

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'foria_jwt',
          oldValue: 'jwt-123',
          newValue: 'jwt-NEW',
        })
      );
    });

    expect(mockSocket.connect).toHaveBeenCalledTimes(1);
    expect(mockIo).toHaveBeenCalledTimes(1);
  });

  test('joinRooms/leaveRoom helpers emit with normalized strings', () => {
    renderWithProvider();

    act(() => {
      ctxRef.connect();
    });

    mockSocket.emit.mockClear();

    act(() => {
      ctxRef.joinRooms([1, '2', 3]);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith('join:rooms', [
      '1',
      '2',
      '3',
    ]);

    act(() => {
      ctxRef.leaveRoom(99);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith('leave_room', '99');
  });
});