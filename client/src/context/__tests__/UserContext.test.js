import { useEffect } from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// ---- Mock i18n so changeLanguage resolves quickly ----
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: {
    changeLanguage: jest.fn(() => Promise.resolve()),
  },
}));
import i18n from '@/i18n';

// ---- Mock encryption helpers so tests do not touch IndexedDB/pairing ----
jest.mock('@/utils/encryptionClient', () => ({
  __esModule: true,
  getLocalKeyBundleMeta: jest.fn(() => Promise.resolve(null)),
  getUnlockedPrivateKeyForPublicKey: jest.fn(),
  unlockKeyBundle: jest.fn(),
  getPersistedUnlockPasscodeForSession: jest.fn(() => null),
  clearPersistedUnlockPasscodeForSession: jest.fn(),
  requestBrowserPairing: jest.fn(),
  tryInstallKeysFromApprovedPairing: jest.fn(),
}));

// ---- Axios mocks ----
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
  },
}));

// ---- SocketContext mocks ----
const mockReconnect = jest.fn();
const mockRefreshRooms = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../SocketContext', () => ({
  __esModule: true,
  useSocket: () => ({
    reconnect: mockReconnect,
    refreshRooms: mockRefreshRooms,
    disconnect: mockDisconnect,
  }),
}));

// SUT
import { UserProvider, useUser } from '../UserContext';

// ---- Test harness ----
function Consumer() {
  const ctx = useUser();

  useEffect(() => {
    window.__userCtx = ctx;
  }, [ctx]);

  return (
    <div>
      <div data-testid="authLoading">{String(ctx.authLoading)}</div>
      <div data-testid="authError">{ctx.authError || ''}</div>
      <div data-testid="currentUser">
        {ctx.currentUser ? JSON.stringify(ctx.currentUser) : ''}
      </div>

      <button onClick={ctx.logout} data-testid="logout">
        Logout
      </button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <UserProvider>
      <Consumer />
    </UserProvider>
  );
}

beforeEach(() => {
  mockReconnect.mockClear();
  mockRefreshRooms.mockClear();
  mockDisconnect.mockClear();
  mockGet.mockReset();
  mockPost.mockReset();
  i18n.changeLanguage.mockClear();

  localStorage.clear();

  // UserContext calls /auth/me once before bootstrap if there is no auth hint.
  // This fake token makes tests use the normal single bootstrap request.
  localStorage.setItem('foria_jwt', 'test-token');

  Object.defineProperty(document, 'cookie', {
    value: '',
    writable: true,
    configurable: true,
  });

  Object.defineProperty(window.navigator, 'language', {
    value: 'en-US',
    configurable: true,
  });

  delete window.__userCtx;
});

afterEach(() => {
  localStorage.clear();
  delete window.__userCtx;
});

// ---- Tests ----
describe('UserContext', () => {
  test('bootstrap success: sets user, calls reconnect & refreshRooms, clears errors, stops loading', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 7, email: 'user@x.com' } });
    mockRefreshRooms.mockResolvedValueOnce(['1', '2']);

    renderWithProvider();

    expect(screen.getByTestId('authLoading').textContent).toBe('true');

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    expect(screen.getByTestId('currentUser').textContent).toContain('"id":7');
    expect(screen.getByTestId('authError').textContent).toBe('');

    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(mockRefreshRooms).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).not.toHaveBeenCalled();

    expect(i18n.changeLanguage).toHaveBeenCalled();
  });

  test('bootstrap success with { user: ... } shape is supported', async () => {
    mockGet.mockResolvedValueOnce({ data: { user: { id: 9, name: 'Ada' } } });
    mockRefreshRooms.mockResolvedValueOnce([]);

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    expect(screen.getByTestId('currentUser').textContent).toContain('"id":9');
    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(mockRefreshRooms).toHaveBeenCalledTimes(1);
  });

  test('bootstrap 401: sets currentUser null, disconnects, stops loading without error', async () => {
    mockGet.mockRejectedValueOnce({ response: { status: 401 } });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    expect(screen.getByTestId('currentUser').textContent).toBe('');
    expect(screen.getByTestId('authError').textContent).toBe('');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockReconnect).not.toHaveBeenCalled();
    expect(mockRefreshRooms).not.toHaveBeenCalled();
  });

  test('bootstrap non-401 error: sets error message, user null, disconnects, stops loading', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    expect(screen.getByTestId('currentUser').textContent).toBe('');
    expect(screen.getByTestId('authError').textContent).toBe(
      'Failed to verify session'
    );
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  test('global auth-unauthorized event clears user and disconnects', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 1 } });
    mockRefreshRooms.mockResolvedValueOnce([]);

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    expect(screen.getByTestId('currentUser').textContent).toContain('"id":1');

    act(() => {
      window.dispatchEvent(new Event('auth-unauthorized'));
    });

    expect(screen.getByTestId('currentUser').textContent).toBe('');
    expect(mockDisconnect).toHaveBeenCalled();
  });

  test('logout: POST /auth/logout, clears tokens/cookies, sets user null, disconnects', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 3 } });
    mockPost.mockResolvedValueOnce({ data: { ok: true } });
    mockRefreshRooms.mockResolvedValueOnce([]);

    localStorage.setItem('token', 'abc');
    localStorage.setItem('foria_jwt', 'xyz');

    Object.defineProperty(document, 'cookie', {
      value: 'foria_jwt=xyz',
      writable: true,
      configurable: true,
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    fireEvent.click(screen.getByTestId('logout'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/logout',
        {},
        expect.objectContaining({
          withCredentials: true,
          headers: expect.objectContaining({
            'X-Requested-With': 'XMLHttpRequest',
          }),
        })
      );
    });

    await waitFor(() => {
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('foria_jwt')).toBeNull();
      expect(localStorage.getItem('cf_session')).toBeNull();
      expect(screen.getByTestId('currentUser').textContent).toBe('');
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  test('provider value has expected shape', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 11 } });
    mockRefreshRooms.mockResolvedValueOnce([]);

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    const ctx = window.__userCtx;

    expect(ctx).toBeTruthy();
    expect(typeof ctx.logout).toBe('function');
    expect('currentUser' in ctx).toBe(true);
    expect('authLoading' in ctx).toBe(true);
    expect('authError' in ctx).toBe(true);
    expect('setCurrentUser' in ctx).toBe(true);
  });
});