import React, { useEffect } from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// ---- Mocks ----
const getMock = jest.fn();
const postMock = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => getMock(...a),
    post: (...a) => postMock(...a),
  },
}));

const reconnectMock = jest.fn();
const refreshRoomsMock = jest.fn();
const disconnectMock = jest.fn();

jest.mock('./SocketContext', () => ({
  __esModule: true,
  useSocket: () => ({
    reconnect: reconnectMock,
    refreshRooms: refreshRoomsMock,
    disconnect: disconnectMock,
  }),
}));

// SUT
import { UserProvider, useUser } from './UserContext';

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
  reconnectMock.mockClear();
  refreshRoomsMock.mockClear();
  disconnectMock.mockClear();
  getMock.mockReset();
  postMock.mockReset();

  // Ensure localStorage/cookies predictable between tests
  localStorage.clear();
  Object.defineProperty(document, 'cookie', { value: '', writable: true, configurable: true });

  return render(
    <UserProvider>
      <Consumer />
    </UserProvider>
  );
}

// ---- Tests ----
describe('UserContext', () => {
  test('bootstrap success: sets user, calls reconnect & refreshRooms, clears errors, stops loading', async () => {
    getMock.mockResolvedValueOnce({ data: { id: 7, email: 'user@x.com' } });
    refreshRoomsMock.mockResolvedValueOnce(['1', '2']);

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
    expect(reconnectMock).toHaveBeenCalledTimes(1);
    expect(refreshRoomsMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  test('bootstrap success with { user: ... } shape is supported', async () => {
    getMock.mockResolvedValueOnce({ data: { user: { id: 9, name: 'Ada' } } });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    expect(screen.getByTestId('currentUser').textContent).toContain('"id":9');
    expect(reconnectMock).toHaveBeenCalledTimes(1);
    expect(refreshRoomsMock).toHaveBeenCalledTimes(1);
  });

  test('bootstrap 401: sets currentUser null, disconnects, stops loading without error', async () => {
    getMock.mockRejectedValueOnce({ response: { status: 401 } });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    expect(screen.getByTestId('currentUser').textContent).toBe('');
    expect(screen.getByTestId('authError').textContent).toBe('');
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(reconnectMock).not.toHaveBeenCalled();
    expect(refreshRoomsMock).not.toHaveBeenCalled();
  });

  test('bootstrap non-401 error: sets error message, user null, disconnects, stops loading', async () => {
    getMock.mockRejectedValueOnce(new Error('boom'));

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    expect(screen.getByTestId('currentUser').textContent).toBe('');
    expect(screen.getByTestId('authError').textContent).toBe('Failed to verify session');
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  test('global auth-unauthorized event clears user and disconnects', async () => {
    getMock.mockResolvedValueOnce({ data: { id: 1 } });

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
    expect(disconnectMock).toHaveBeenCalled();
  });

  test('logout: POST /auth/logout, clears tokens/cookies, sets user null, disconnects', async () => {
    getMock.mockResolvedValueOnce({ data: { id: 3 } });
    postMock.mockResolvedValueOnce({ data: { ok: true } });

    // Seed tokens to verify they get cleared
    localStorage.setItem('token', 'abc');
    localStorage.setItem('foria_jwt', 'xyz');
    Object.defineProperty(document, 'cookie', { value: 'foria_jwt=xyz', writable: true });

    renderWithProvider();
    await waitFor(() => {
      expect(screen.getByTestId('authLoading').textContent).toBe('false');
    });

    // Call logout
    fireEvent.click(screen.getByTestId('logout'));

    // POST was attempted (even if it fails, the rest should proceed)
    expect(postMock).toHaveBeenCalledWith(
      '/auth/logout',
      null,
      expect.objectContaining({ headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    );

    // Tokens cleared
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('foria_jwt')).toBeNull();
    expect(document.cookie.includes('foria_jwt=')).toBe(false);

    // User cleared & socket disconnected
    expect(screen.getByTestId('currentUser').textContent).toBe('');
    expect(disconnectMock).toHaveBeenCalled();
  });

  test('provider value has expected shape', async () => {
    getMock.mockResolvedValueOnce({ data: { id: 11 } });

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
