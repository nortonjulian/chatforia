import { render, screen, waitFor } from '@testing-library/react';

// ---- Axios mock ----
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

import axiosClient from '@/api/axiosClient';

// ---- Mantine minimal shims ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const passthru = (tid) => ({ children, ...p }) => (
    <div data-testid={tid} {...p}>
      {children}
    </div>
  );

  const Button = ({ children, component, to, ...p }) => {
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

  return {
    __esModule: true,
    Button,
    Center,
    Paper,
    Stack,
    Title,
    Text,
    Loader,
  };
});

// ---- Router params + Link shim ----
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
  beforeEach(() => {
    jest.clearAllMocks();
    mockUid = 'u123';
    mockToken = 't456';
  });

  test('calls verify endpoint with uid & token, then shows success with login link', async () => {
    axiosClient.get.mockResolvedValueOnce({
      data: { ok: true },
    });

    render(<VerifyEmail />);

    expect(screen.getByText(/email verification/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/loader/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(axiosClient.get).toHaveBeenCalledWith('/auth/email/verify', {
        params: {
          uid: 'u123',
          token: 't456',
        },
      });
    });

    expect(
      await screen.findByText(/your email is verified/i)
    ).toBeInTheDocument();

    const loginLink = screen.getByRole('link', {
      name: /continue to login/i,
    });

    expect(loginLink).toHaveAttribute('href', '/');
  });

  test('server returns ok=false -> shows error with back-to-login link', async () => {
    axiosClient.get.mockResolvedValueOnce({
      data: { ok: false },
    });

    render(<VerifyEmail />);

    await waitFor(() => {
      expect(axiosClient.get).toHaveBeenCalled();
    });

    expect(await screen.findByText(/invalid or expired/i)).toBeInTheDocument();

    const backLink = screen.getByRole('link', {
      name: /back to login/i,
    });

    expect(backLink).toHaveAttribute('href', '/');
  });

  test('network error -> shows error state', async () => {
    axiosClient.get.mockRejectedValueOnce(new Error('network'));

    render(<VerifyEmail />);

    expect(await screen.findByText(/invalid or expired/i)).toBeInTheDocument();
  });

  test('missing params -> does not call axios and shows error', async () => {
    mockUid = null;
    mockToken = null;

    render(<VerifyEmail />);

    await waitFor(() => {
      expect(axiosClient.get).not.toHaveBeenCalled();
      expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    });
  });
});