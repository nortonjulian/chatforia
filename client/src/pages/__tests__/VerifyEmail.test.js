import { render, screen, waitFor } from '@testing-library/react';

// ---- Mantine minimal shims ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...p }) => (
    <div data-testid={tid} {...p}>
      {children}
    </div>
  );
  const Button = ({ children, component, to, ...p }) => {
    // support Button component={Link} to="/path"
    if (component) {
      return (
        <a href={to} {...p}>
          {children}
        </a>
      );
    }
    return <button {...p}>{children}</button>;
  };
  const Center = passthru('center');
  const Paper = passthru('paper');
  const Stack = passthru('stack');
  const Title = ({ children }) => <h3>{children}</h3>;
  const Text = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Loader = () => <div aria-label="loader">...</div>;
  return { __esModule: true, Button, Center, Paper, Stack, Title, Text, Loader };
});

// ---- Router params + Link shim ----
// IMPORTANT: use names prefixed with "mock" so Jest allows closing over them in the mock factory.
let mockUid = 'u123';
let mockToken = 't456';

jest.mock('react-router-dom', () => ({
  __esModule: true,
  useSearchParams: () => [
    {
      get: (k) => (k === 'uid' ? mockUid : k === 'token' ? mockToken : null),
    },
  ],
  Link: ({ to, children, ...p }) => (
    <a href={to} {...p}>
      {children}
    </a>
  ),
}));

// ---- SUT ----
import VerifyEmail from '../VerifyEmail';

describe('VerifyEmail', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    // reset default params
    mockUid = 'u123';
    mockToken = 't456';
  });

  test('calls verify endpoint with uid & token, then shows success with login link', async () => {
    const jsonMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = jest.fn().mockResolvedValue({ json: jsonMock });

    render(<VerifyEmail />);

    // Loading state visible first
    expect(screen.getByText(/Email verification/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/loader/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/auth/email/verify?uid=u123&token=t456');
    });

    // Success UI
    expect(await screen.findByText(/Your email is verified/i)).toBeInTheDocument();
    const loginLink = screen.getByRole('link', { name: /Continue to login/i });
    expect(loginLink).toHaveAttribute('href', '/login');
  });

  test('server returns ok=false -> shows error with resend link', async () => {
    const jsonMock = jest.fn().mockResolvedValue({ ok: false });
    global.fetch = jest.fn().mockResolvedValue({ json: jsonMock });

    render(<VerifyEmail />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(await screen.findByText(/invalid or expired/i)).toBeInTheDocument();
    const resend = screen.getByRole('link', { name: /Resend verification email/i });
    expect(resend).toHaveAttribute('href', '/resend');
  });

  test('network error -> shows error state', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));

    render(<VerifyEmail />);

    await waitFor(() => expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument());
  });

  test('missing params -> does not call fetch and shows error', async () => {
    mockUid = null;
    mockToken = null;
    global.fetch = jest.fn();

    render(<VerifyEmail />);

    // No request made
    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    });
  });
});
