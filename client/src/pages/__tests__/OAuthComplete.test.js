import { render, screen, waitFor, act } from '@testing-library/react';

// ---- Mocks ----

// Mantine (simple stubs)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );
  const Text = ({ children, ...rest }) => <div {...rest}>{children}</div>;
  const Loader = () => <div data-testid="loader">loader</div>;
  return {
    __esModule: true,
    Center: passthru('center'),
    Stack: passthru('stack'),
    Text,
    Loader,
  };
});

// Router
const navigateMock = jest.fn();
let searchParams = new URLSearchParams(); // will be set per test
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => navigateMock,
  useSearchParams: () => [searchParams],
}));

// User context
const setCurrentUserMock = jest.fn();
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ setCurrentUser: setCurrentUserMock }),
}));

// API client
const getMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...a) => getMock(...a) },
}));

// SUT
import OAuthComplete from './OAuthComplete';

// Helpers
const deferred = () => {
  let resolve, reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise: p, resolve, reject };
};

describe('OAuthComplete', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setCurrentUserMock.mockReset();
    getMock.mockReset();
    searchParams = new URLSearchParams(); // default no "next"
  });

  test('renders loading UI', () => {
    // Leave requests pending
    getMock.mockReturnValue(new Promise(() => {}));

    render(<OAuthComplete />);
    expect(screen.getByTestId('loader')).toBeInTheDocument();
    expect(screen.getByText(/Completing sign-in…/i)).toBeInTheDocument();
  });

  test('success via /auth/me: sets user and navigates to next path', async () => {
    searchParams = new URLSearchParams('next=/inbox');
    getMock.mockResolvedValueOnce({ data: { user: { id: 1, name: 'A' } } });

    render(<OAuthComplete />);

    await waitFor(() => {
      expect(setCurrentUserMock).toHaveBeenCalledWith({ id: 1, name: 'A' });
      expect(navigateMock).toHaveBeenCalledWith('/inbox', { replace: true });
    });
    // Only /auth/me called
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/auth/me');
  });

  test('fallback: /auth/me fails, /users/me succeeds', async () => {
    getMock
      .mockRejectedValueOnce(new Error('nope'))                 // /auth/me
      .mockResolvedValueOnce({ data: { id: 2, name: 'B' } });   // /users/me (plain user)

    render(<OAuthComplete />);

    await waitFor(() => {
      expect(setCurrentUserMock).toHaveBeenCalledWith({ id: 2, name: 'B' });
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });
    expect(getMock.mock.calls[0][0]).toBe('/auth/me');
    expect(getMock.mock.calls[1][0]).toBe('/users/me');
  });

  test('failure: both endpoints fail (or no user) -> navigate to /login?error=sso_failed', async () => {
    // Case A: both reject
    getMock
      .mockRejectedValueOnce(new Error('x')) // /auth/me
      .mockRejectedValueOnce(new Error('y')); // /users/me

    render(<OAuthComplete />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/login?error=sso_failed', { replace: true });
    });

    // Case B: endpoints resolve but without user
    navigateMock.mockReset();
    getMock.mockReset();
    getMock
      .mockResolvedValueOnce({ data: {} })     // /auth/me
      .mockResolvedValueOnce({ data: null });  // /users/me

    render(<OAuthComplete />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/login?error=sso_failed', { replace: true });
    });
  });

  test('cleanup: unmount prevents setCurrentUser/navigate after resolution', async () => {
    const authDef = deferred();
    const usersDef = deferred();

    // First call returns nullish (simulate /auth/me failing to produce user but not throwing),
    // second also returns nullish; but we'll unmount before they finish.
    getMock
      .mockReturnValueOnce(authDef.promise)   // /auth/me
      .mockReturnValueOnce(usersDef.promise); // /users/me

    const { unmount } = render(<OAuthComplete />);
    unmount(); // triggers `cancelled = true`

    // Resolve both after unmount
    await act(async () => {
      authDef.resolve({ data: null });
      usersDef.resolve({ data: null });
      // allow effect microtasks to flush
    });

    // No navigation or context updates after unmount
    expect(setCurrentUserMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
