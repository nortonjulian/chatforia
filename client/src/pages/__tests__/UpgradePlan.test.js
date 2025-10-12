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
  return { __esModule: true, Card, Title, Text, Button, Group, Stack, Badge };
});

// ---- Auth/User context ----
let currentUserMock = { plan: 'FREE' };
jest.mock('../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: currentUserMock }),
}));

// ---- Axios client ----
const postMock = jest.fn();
jest.mock('../api/axiosClient', () => ({
  __esModule: true,
  default: { post: (...a) => postMock(...a) },
}));

// ---- toast ----
const toastInfo = jest.fn();
const toastErr = jest.fn();
jest.mock('@/utils/toast', () => ({
  __esModule: true,
  toast: {
    info: (...a) => toastInfo(...a),
    err:  (...a) => toastErr(...a),
  },
}));

// ---- SUT ----
import UpgradePage from './UpgradePlan';

// ---- Helpers ----
const setHrefSpy = () => {
  const original = window.location;
  delete window.location;
  // @ts-ignore
  window.location = { href: '' };
  return () => { window.location = original; };
};

describe('UpgradePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentUserMock = { plan: 'FREE' };
  });

  test('renders Free and Premium cards; Free is the current plan (button disabled)', () => {
    render(<UpgradePage />);

    // Free card CTA text
    expect(screen.getByText(/Free/i)).toBeInTheDocument();
    const freeCta = screen.getByRole('button', { name: /Current Plan/i });
    expect(freeCta).toBeDisabled();

    // Premium card CTA text
    const premCta = screen.getByRole('button', { name: /Upgrade/i });
    expect(premCta).toBeEnabled();
  });

  test('FREE user: clicking "Upgrade" posts checkout and redirects to returned URL', async () => {
    const restoreHref = setHrefSpy();
    postMock.mockResolvedValueOnce({ data: { checkoutUrl: 'https://pay.example/checkout' } });

    render(<UpgradePage />);

    const btn = screen.getByRole('button', { name: /Upgrade/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/billing/checkout', { plan: 'PREMIUM_MONTHLY' });
    });
    expect(toastInfo).toHaveBeenCalledWith('Redirecting to secure checkout…');

    // navigated
    expect(window.location.href).toBe('https://pay.example/checkout');

    restoreHref();
  });

  test('FREE user: checkout error shows toast.err and does not navigate', async () => {
    const restoreHref = setHrefSpy();
    postMock.mockRejectedValueOnce({ response: { data: { message: 'Stripe not configured' } } });

    render(<UpgradePage />);

    fireEvent.click(screen.getByRole('button', { name: /Upgrade/i }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/billing/checkout', { plan: 'PREMIUM_MONTHLY' });
    });
    expect(toastErr).toHaveBeenCalledWith('Stripe not configured');
    expect(window.location.href).toBe(''); // unchanged

    restoreHref();
  });

  test('Premium user: CTA is "Manage Billing"; clicking opens billing portal URL', async () => {
    const restoreHref = setHrefSpy();
    currentUserMock = { plan: 'PREMIUM' };
    postMock.mockResolvedValueOnce({ data: { portalUrl: 'https://billing.example/portal' } });

    render(<UpgradePage />);

    const btn = screen.getByRole('button', { name: /Manage Billing/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/billing/portal', {});
    });
    expect(toastInfo).toHaveBeenCalledWith('Opening billing portal…');
    expect(window.location.href).toBe('https://billing.example/portal');

    restoreHref();
  });

  test('Premium user: portal error shows toast.err', async () => {
    currentUserMock = { plan: 'pro', id: 1 }; // anything not "FREE" is treated as premium
    postMock.mockRejectedValueOnce(new Error('network down'));

    render(<UpgradePage />);

    fireEvent.click(screen.getByRole('button', { name: /Manage Billing/i }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/billing/portal', {});
    });
    expect(toastErr).toHaveBeenCalledWith('network down');
  });

  test('loading states switch button text/aria-busy while requests are pending', async () => {
    // FREE → Upgrade path loading text "Redirecting…"
    let resolveCheckout;
    postMock.mockReturnValueOnce(new Promise(res => (resolveCheckout = res)));
    render(<UpgradePage />);

    const upBtn = screen.getByRole('button', { name: /Upgrade/i });
    fireEvent.click(upBtn);

    // While pending: the Button content should change to "Redirecting…"
    expect(screen.getByRole('button', { name: /Redirecting…/i })).toHaveAttribute('aria-busy', 'true');

    // Finish
    resolveCheckout({ data: { checkoutUrl: 'https://x' } });

    // Premium path loading text "Opening…"
    jest.clearAllMocks();
    // re-render as Premium
    let resolvePortal;
    currentUserMock = { plan: 'PREMIUM' };
    postMock.mockReturnValueOnce(new Promise(res => (resolvePortal = res)));

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
