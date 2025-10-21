import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Minimal Mantine stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...p }) => <div data-testid={tid} {...p}>{children}</div>;
  const Button = ({ children, onClick, disabled, loading, ...p }) => (
    <button
      onClick={onClick}
      disabled={!!disabled || !!loading}
      aria-busy={loading ? 'true' : 'false'}
      {...p}
    >
      {children}
    </button>
  );
  const Title = passthru('title');
  const Text = passthru('text');
  const Card = passthru('card');
  const Group = passthru('group');
  const Stack = passthru('stack');
  const Badge = passthru('badge');
  const Alert = passthru('alert');
  return { __esModule: true, Card, Title, Text, Button, Group, Stack, Badge, Alert };
});

// ---- Router bits we need ----
jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ to, children, ...p }) => <a href={to} {...p}>{children}</a>,
  useNavigate: () => jest.fn(),
}));

// ---- Auth/User context ----
// IMPORTANT: variable name must start with "mock" for Jest's factory rule
let mockCurrentUser = { plan: 'FREE' };
jest.mock('../components/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: mockCurrentUser }),
}), { virtual: true });

// ---- Axios client ----
const mockPost = jest.fn();
const mockGet  = jest.fn();
jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: { post: (...a) => mockPost(...a), get: (...a) => mockGet(...a) },
}));

// ---- SUT ----
import UpgradePage from '../UpgradePlan';

// ---- Helpers ----
const setHrefSpy = () => {
  const original = window.location;
  // @ts-ignore
  delete window.location;
  // @ts-ignore
  window.location = { href: '' };
  return () => { window.location = original; };
};

describe('UpgradePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = { plan: 'FREE' };
  });

  test('renders Free and Premium cards; Free is the current plan (button disabled)', () => {
    render(<UpgradePage />);

    expect(screen.getByText(/Free/i)).toBeInTheDocument();
    const freeCta = screen.getByRole('button', { name: /Current Plan/i });
    expect(freeCta).toBeDisabled();

    const premCta = screen.getByRole('button', { name: /Upgrade/i });
    expect(premCta).toBeEnabled();
  });

  test('FREE user: clicking "Upgrade" posts checkout and redirects to returned URL', async () => {
    const restoreHref = setHrefSpy();
    mockPost.mockResolvedValueOnce({ data: { checkoutUrl: 'https://pay.example/checkout' } });

    render(<UpgradePage />);

    fireEvent.click(screen.getByRole('button', { name: /Upgrade/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/billing/checkout', { plan: 'PREMIUM_MONTHLY' });
    });

    expect(window.location.href).toBe('https://pay.example/checkout');
    restoreHref();
  });

  test('FREE user: checkout error does not navigate', async () => {
    const restoreHref = setHrefSpy();
    mockPost.mockRejectedValueOnce({ response: { data: { message: 'Stripe not configured' } } });

    render(<UpgradePage />);

    fireEvent.click(screen.getByRole('button', { name: /Upgrade/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/billing/checkout', { plan: 'PREMIUM_MONTHLY' });
    });
    expect(window.location.href).toBe(''); // unchanged
    restoreHref();
  });

  test('Premium user: CTA is "Manage Billing"; clicking opens billing portal URL', async () => {
    const restoreHref = setHrefSpy();
    mockCurrentUser = { plan: 'PREMIUM' };
    mockPost.mockResolvedValueOnce({ data: { portalUrl: 'https://billing.example/portal' } });

    render(<UpgradePage />);

    fireEvent.click(screen.getByRole('button', { name: /Manage Billing/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/billing/portal', {});
    });
    expect(window.location.href).toBe('https://billing.example/portal');
    restoreHref();
  });

  test('Premium user: portal error handled', async () => {
    mockCurrentUser = { plan: 'PREMIUM', id: 1 };
    mockPost.mockRejectedValueOnce(new Error('network down'));

    render(<UpgradePage />);

    fireEvent.click(screen.getByRole('button', { name: /Manage Billing/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/billing/portal', {});
    });
  });

  test('loading states switch button text/aria-busy while requests are pending', async () => {
    // FREE → Upgrade path loading text "Redirecting…"
    let resolveCheckout;
    mockPost.mockReturnValueOnce(new Promise(res => (resolveCheckout = res)));
    render(<UpgradePage />);

    const upBtn = screen.getByRole('button', { name: /Upgrade/i });
    fireEvent.click(upBtn);

    expect(screen.getByRole('button', { name: /Redirecting…/i })).toHaveAttribute('aria-busy', 'true');

    resolveCheckout({ data: { checkoutUrl: 'https://x' } });

    // Premium path loading text "Opening…"
    jest.clearAllMocks();
    let resolvePortal;
    mockCurrentUser = { plan: 'PREMIUM' };
    mockPost.mockReturnValueOnce(new Promise(res => (resolvePortal = res)));

    render(<UpgradePage />);
    const manageBtn = screen.getByRole('button', { name: /Manage Billing/i });
    fireEvent.click(manageBtn);
    expect(screen.getByRole('button', { name: /Opening…/i })).toHaveAttribute('aria-busy', 'true');
    resolvePortal({ data: { portalUrl: 'https://y' } });
  });

  test('Free card onClick attempts to show info but is disabled for Free users', () => {
    render(<UpgradePage />);
    const freeBtn = screen.getByRole('button', { name: /Current Plan/i });
    expect(freeBtn).toBeDisabled();
  });
});
