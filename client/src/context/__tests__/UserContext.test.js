import React, { useEffect } from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// ---- Mocks ----
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
  },
}));

const mockReconnect = jest.fn();
const mockRefreshRooms = jest.fn();
const mockDisconnect = jest.fn();

// Socket hook lives next to the SUT, so go up one directory
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
    // Expose on window for direct access in tests if needed
    window.__userCtx = ctx;
  }, [ctx]);
  return (
    <div>
      <div data-testid="authLoading">{String(ctx.authLoading)}</div>
      <div data-testid="authError">{ctx.authError || ''}</div>
      <div data-testid="currentUser">
        {ctx.currentUser ? JSON.stringify(ctx.currentUser) : ''}
      </div>
      <button onClick={ctx.logout} data-testid="logout">Logout</button>
    </div>
  );
}

function renderWithProvider() {
  // NOTE: Do NOT reset mocks here — that would wipe per-test mockResolvedValueOnce()
  return render(
    <UserProvider>
      <Consumer />
    </UserProvider>
  );
}

beforeEach(() => {
  // Clear/reset mocks BEFORE each test, not inside renderWithProvider
  mockReconnect.mockClear();
  mockRefreshRooms.mockClear();
  mockDisconnect.mockClear();
  mockGet.mockReset();
  mockPost.mockReset();

  // Ensure localStorage/cookies predictable between tests
  localStorage.clear();
  Object.defineProperty(document, 'cookie', { value: '', writable: true, configurable: true });
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

    // User set
    expect(screen.getByTestId('currentUser').textContent).toContain('"id":7');
    // No error
    expect(screen.getByTestId('authError').textContent).toBe('');

    // Socket lifecycle
    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(mockRefreshRooms).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  test('bootstrap success with { user: ... } shape is supported', async () => {
    mockGet.mockResolvedValueOnce({ data: { user: { id: 9, name: 'Ada' } } });

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
    expect(screen.getByTestId('authError').textContent).toBe('Failed to verify session');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  test('global auth-unauthorized event clears user and disconnects', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 1 } });

    renderWithProvider();
    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    // Sanity: user set
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

  // seed
  localStorage.setItem('token', 'abc');
  localStorage.setItem('foria_jwt', 'xyz');
  Object.defineProperty(document, 'cookie', { value: 'foria_jwt=xyz', writable: true });

  renderWithProvider();
  await waitFor(() => {
    expect(screen.getByTestId('authLoading').textContent).toBe('false');
  });

  // trigger
  fireEvent.click(screen.getByTestId('logout'));

  // wait for the effect of logout to complete
  await waitFor(() => expect(mockPost).toHaveBeenCalled());

  // now assert side effects
  await waitFor(() => {
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('foria_jwt')).toBeNull();
    expect(document.cookie).toMatch(/foria_jwt=;.*Max-Age=0/);
    expect(screen.getByTestId('currentUser').textContent).toBe('');
    expect(mockDisconnect).toHaveBeenCalled();
  });
});


  test('provider value has expected shape', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 11 } });

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
