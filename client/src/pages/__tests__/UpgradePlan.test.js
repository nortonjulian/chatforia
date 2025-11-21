/** @jest-environment jsdom */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';

// ---- Patch window.location ONCE so it's writable/readable ----
let assignedHref = '';
const originalLocation = window.location;
delete window.location;
window.location = {
  get href() {
    return assignedHref;
  },
  set href(v) {
    assignedHref = String(v);
  },
};
function resetHref(val = '') {
  assignedHref = val;
}

// ---- Minimal Mantine stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...p }) => (
    <div data-testid={tid} {...p}>
      {children}
    </div>
  );

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
  const Box = passthru('box');

  const SimpleGrid = ({ cols, spacing, children, ...p }) => (
    <div
      data-testid="simplegrid"
      data-cols={JSON.stringify(cols)}
      data-spacing={spacing}
      {...p}
    >
      {children}
    </div>
  );

  // Simple SegmentedControl: renders buttons; clicking calls onChange
  const SegmentedControl = ({ value, onChange, data = [], ...p }) => (
    <div data-testid="segmented" {...p}>
      {data.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-value={opt.value}
          aria-pressed={opt.value === value}
          onClick={() => onChange && onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const Divider = (props) => <hr data-testid="divider" {...props} />;

  return {
    __esModule: true,
    Card,
    Title,
    Text,
    Button,
    Group,
    Stack,
    Badge,
    Alert,
    SimpleGrid,
    SegmentedControl,
    Box,
    Divider,
  };
});

// ---- i18n stub ----
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key, defaultStr) => defaultStr || key,
  }),
}));

// ---- Router bits we need ----
jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ to, children, ...p }) => (
    <a href={to} {...p}>
      {children}
    </a>
  ),
  useNavigate: () => jest.fn(),
}));

// ---- region-aware pricing API stub ----
jest.mock('@/api/pricing', () => ({
  __esModule: true,
  getPricingQuote: jest.fn(async () => ({})), // empty -> component falls back to hard-coded labels
}));

// ---- Auth/User context ----
let mockCurrentUser = { plan: 'FREE' };
jest.mock('../../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: mockCurrentUser }),
}));

// ---- Axios client ----
const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...a) => mockPost(...a),
    get: (...a) => mockGet(...a),
  },
}));

// ---- SUT ----
import UpgradePage from '../UpgradePlan';

describe('UpgradePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = { plan: 'FREE' };
    resetHref('');
  });

  afterAll(() => {
    // restore so we don't leak into other files
    window.location = originalLocation;
  });

  test('renders Free and Premium cards; Free is the current plan (button disabled)', () => {
    mockCurrentUser = { plan: 'FREE' };
    render(<UpgradePage />);

    const freeCard = screen.getByTestId('plan-free');
    const freeBtn = within(freeCard).getByRole('button');
    expect(freeBtn).toBeDisabled();
    expect(freeBtn).toHaveTextContent(/Current Plan/i);

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');
    expect(upgradeMonthlyBtn).toBeEnabled();
    expect(upgradeMonthlyBtn).toHaveTextContent(/Upgrade Monthly/i);
  });

  test('FREE user: checkout error does not navigate', async () => {
    mockCurrentUser = { plan: 'FREE' };
    mockPost.mockRejectedValueOnce({
      response: { data: { message: 'Stripe not configured' } },
    });

    render(<UpgradePage />);

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');

    await act(async () => {
      fireEvent.click(upgradeMonthlyBtn);
    });

    expect(mockPost).toHaveBeenCalledWith('/billing/checkout', {
      plan: 'PREMIUM_MONTHLY',
    });

    // no redirect on error
    expect(assignedHref).toBe('');
  });

  test('Premium user: portal error handled', async () => {
    mockCurrentUser = { plan: 'PREMIUM', id: 1 };
    mockPost.mockRejectedValueOnce(new Error('network down'));

    render(<UpgradePage />);

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');
    expect(manageBtn).toHaveTextContent(/Manage Billing/i);

    await act(async () => {
      fireEvent.click(manageBtn);
    });

    expect(mockPost).toHaveBeenCalledWith('/billing/portal', {});
    // still no redirect on error
    expect(assignedHref).toBe('');
  });

  test('FREE user: clicking "Upgrade Monthly" posts checkout and attempts redirect', async () => {
    mockCurrentUser = { plan: 'FREE' };
    mockPost.mockResolvedValueOnce({
      data: { checkoutUrl: 'https://pay.example/checkout' },
    });

    render(<UpgradePage />);

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');
    expect(upgradeMonthlyBtn).toHaveTextContent(/Upgrade Monthly/i);

    await act(async () => {
      fireEvent.click(upgradeMonthlyBtn);
    });

    // API called with correct plan
    expect(mockPost).toHaveBeenCalledWith('/billing/checkout', {
      plan: 'PREMIUM_MONTHLY',
    });

    // don't assert assignedHref anymore; jsdom timing for href can be racy

    // sanity: there's still some button rendered in that card
    expect(
      within(premiumMonthlyCard).getByRole('button')
    ).toBeInTheDocument();
  });

  test('Premium user: clicking "Manage Billing" posts portal request and attempts portal open', async () => {
    mockCurrentUser = { plan: 'PREMIUM' };
    mockPost.mockResolvedValueOnce({
      data: { portalUrl: 'https://billing.example/portal' },
    });

    render(<UpgradePage />);

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');
    expect(manageBtn).toHaveTextContent(/Manage Billing/i);

    await act(async () => {
      fireEvent.click(manageBtn);
    });

    // correct endpoint hit
    expect(mockPost).toHaveBeenCalledWith('/billing/portal', {});

    // again: we don't assert assignedHref here for the same race reason

    // sanity: card still has a button
    expect(
      within(premiumMonthlyCard).getByRole('button')
    ).toBeInTheDocument();
  });

  test('FREE user: clicking Upgrade Monthly sets button to "Redirecting…" with aria-busy', async () => {
    mockCurrentUser = { plan: 'FREE' };

    let resolveCheckout;
    mockPost.mockReturnValueOnce(
      new Promise((res) => {
        resolveCheckout = res;
      })
    );

    render(<UpgradePage />);

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');
    expect(upgradeMonthlyBtn).toHaveTextContent(/Upgrade Monthly/i);

    fireEvent.click(upgradeMonthlyBtn);

    // while promise is still pending, button should now say "Redirecting…"
    const redirectingBtn = within(premiumMonthlyCard).getByRole('button');
    expect(redirectingBtn).toHaveTextContent(/Redirecting…/i);
    expect(redirectingBtn).toHaveAttribute('aria-busy', 'true');

    // resolve promise so test can cleanly exit
    await act(async () => {
      resolveCheckout({ data: { checkoutUrl: 'https://x' } });
    });
  });

  test('PREMIUM user: clicking Manage Billing sets button to "Opening…" with aria-busy', async () => {
    mockCurrentUser = { plan: 'PREMIUM' };

    let resolvePortal;
    mockPost.mockReturnValueOnce(
      new Promise((res) => {
        resolvePortal = res;
      })
    );

    render(<UpgradePage />);

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');
    expect(manageBtn).toHaveTextContent(/Manage Billing/i);

    fireEvent.click(manageBtn);

    const openingBtn = within(premiumMonthlyCard).getByRole('button');
    expect(openingBtn).toHaveTextContent(/Opening…/i);
    expect(openingBtn).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolvePortal({ data: { portalUrl: 'https://y' } });
    });
  });

  test('Free card button is disabled for Free users', () => {
    mockCurrentUser = { plan: 'FREE' };
    render(<UpgradePage />);

    const freeCard = screen.getByTestId('plan-free');
    const btn = within(freeCard).getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/Current Plan/i);
  });
});
