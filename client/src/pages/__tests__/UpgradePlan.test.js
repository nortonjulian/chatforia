/** @jest-environment jsdom */

import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

// ---- Minimal Mantine stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const cleanProps = (props = {}) => {
    const {
      fullWidth,
      withBorder,
      shadow,
      radius,
      gap,
      align,
      justify,
      wrap,
      p,
      px,
      py,
      pt,
      pb,
      pl,
      pr,
      m,
      mx,
      my,
      mt,
      mb,
      ml,
      mr,
      maw,
      mih,
      w,
      h,
      c,
      fw,
      lh,
      size,
      order,
      variant,
      striped,
      highlightOnHover,
      verticalSpacing,
      horizontalSpacing,
      cols,
      spacing,
      component,
      color,
      ...rest
    } = props;

    return rest;
  };

  const passthru = (tid) => ({ children, ...p }) => (
    <div data-testid={tid} {...cleanProps(p)}>
      {children}
    </div>
  );

  const Button = ({ children, onClick, disabled, loading, ...p }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!!disabled || !!loading}
      aria-busy={loading ? 'true' : 'false'}
      {...cleanProps(p)}
    >
      {children}
    </button>
  );

  const TableRoot = ({ children }) => <table>{children}</table>;
  TableRoot.Thead = ({ children }) => <thead>{children}</thead>;
  TableRoot.Tbody = ({ children }) => <tbody>{children}</tbody>;
  TableRoot.Tr = ({ children }) => <tr>{children}</tr>;
  TableRoot.Th = ({ children }) => <th>{children}</th>;
  TableRoot.Td = ({ children }) => <td>{children}</td>;

  const Accordion = ({ children }) => <div data-testid="accordion">{children}</div>;
  Accordion.Item = ({ children }) => <div>{children}</div>;
  Accordion.Control = ({ children }) => <button type="button">{children}</button>;
  Accordion.Panel = ({ children }) => <div>{children}</div>;

  return {
    __esModule: true,
    Card: passthru('card'),
    Title: ({ children, ...p }) => <h2 {...cleanProps(p)}>{children}</h2>,
    Text: ({ children, component: Component = 'div', ...p }) => (
      <Component data-testid="text" {...cleanProps(p)}>
        {children}
      </Component>
    ),
    Button,
    Group: passthru('group'),
    Stack: passthru('stack'),
    Badge: passthru('badge'),
    Alert: ({ children, title, ...p }) => (
      <div role="alert" {...cleanProps(p)}>
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    ),
    SimpleGrid: ({ children, ...p }) => (
      <div data-testid="simplegrid" {...cleanProps(p)}>
        {children}
      </div>
    ),
    SegmentedControl: ({ value, onChange, data = [] }) => (
      <div data-testid="segmented">
        {data.map((opt) => (
          <button
            key={opt.value}
            type="button"
            data-value={opt.value}
            aria-pressed={opt.value === value}
            onClick={() => onChange?.(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    ),
    Box: passthru('box'),
    Divider: ({ label }) => <hr aria-label={label} />,
    Table: TableRoot,
    Accordion,
  };
});

// ---- Icons ----
jest.mock('lucide-react', () => {
  const Icon = () => <span data-testid="icon" />;

  return {
    __esModule: true,
    MessageSquare: Icon,
    Ban: Icon,
    Star: Icon,
    Wallet: Icon,
    CircleDollarSign: Icon,
  };
});

// ---- i18n stub ----
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, defaultStr) => defaultStr || _key,
  }),
}));

// ---- Router ----
const mockNavigate = jest.fn();
const mockSetSearchParams = jest.fn();
const mockSearchParams = new URLSearchParams();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');

  return {
    __esModule: true,
    ...actual,

    Link: ({ to, children, ...p }) => (
      <a href={to} {...p}>
        {children}
      </a>
    ),

    useNavigate: () => mockNavigate,

    useLocation: () => ({
      pathname: '/settings/upgrade',
      search: '',
      state: null,
    }),

    useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  };
});

// ---- Analytics ----
jest.mock('@/utils/analytics', () => ({
  __esModule: true,
  default: {
    capture: jest.fn(),
  },
}));

// ---- region-aware pricing API stub ----
jest.mock('@/api/pricing', () => ({
  __esModule: true,
  getPricingQuote: jest.fn(async () => ({})),
}));

// ---- Auth/User context ----
let mockCurrentUser = { plan: 'FREE' };

jest.mock('../../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: mockCurrentUser,
  }),
}));

// ---- Axios client ----
const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...args) => mockPost(...args),
    get: (...args) => mockGet(...args),
  },
}));

// ---- SUT ----
import UpgradePage from '../UpgradePlan';

describe('UpgradePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCurrentUser = { plan: 'FREE' };

    for (const key of [...mockSearchParams.keys()]) {
      mockSearchParams.delete(key);
    }
  });

  test('renders Free and Premium cards; Free is the current plan', async () => {
    render(<UpgradePage />);

    await screen.findByTestId('plan-free');

    const freeCard = screen.getByTestId('plan-free');
    const freeBtn = within(freeCard).getByRole('button');

    expect(freeBtn).toBeDisabled();
    expect(freeBtn).toHaveTextContent(/current plan/i);

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');

    expect(upgradeMonthlyBtn).toBeEnabled();
    expect(upgradeMonthlyBtn).toHaveTextContent(/upgrade monthly/i);
  });

  test('FREE user: checkout error does not navigate', async () => {
    const redirectSpy = jest.fn();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockPost.mockRejectedValueOnce({
      response: { data: { message: 'Stripe not configured' } },
    });

    render(<UpgradePage redirect={redirectSpy} />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');

    fireEvent.click(upgradeMonthlyBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/billing/checkout', {
        plan: 'PREMIUM_MONTHLY',
      });
    });

    expect(redirectSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  test('FREE user: clicking Upgrade Monthly posts checkout', async () => {
    const redirectSpy = jest.fn();

    mockPost.mockResolvedValueOnce({
      data: { checkoutUrl: 'https://pay.example/checkout' },
    });

    render(<UpgradePage redirect={redirectSpy} />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');

    expect(upgradeMonthlyBtn).toHaveTextContent(/upgrade monthly/i);

    fireEvent.click(upgradeMonthlyBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/billing/checkout', {
        plan: 'PREMIUM_MONTHLY',
      });
    });

    await waitFor(() => {
      expect(redirectSpy).toHaveBeenCalledWith('https://pay.example/checkout');
    });
  });

  test('FREE user: clicking Upgrade Monthly sets button to Redirecting', async () => {
    const redirectSpy = jest.fn();
    let resolveCheckout;

    mockPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheckout = resolve;
      })
    );

    render(<UpgradePage redirect={redirectSpy} />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');

    fireEvent.click(upgradeMonthlyBtn);

    const redirectingBtn = within(premiumMonthlyCard).getByRole('button');

    expect(redirectingBtn).toHaveTextContent(/redirecting/i);
    expect(redirectingBtn).toHaveAttribute('aria-busy', 'true');

    resolveCheckout({ data: { checkoutUrl: 'https://x' } });

    await waitFor(() => {
      expect(redirectSpy).toHaveBeenCalledWith('https://x');
    });
  });

  test('Premium user: portal error handled', async () => {
    const redirectSpy = jest.fn();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockCurrentUser = { plan: 'PREMIUM', id: 1 };

    mockPost.mockRejectedValueOnce(new Error('network down'));

    render(<UpgradePage redirect={redirectSpy} />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');

    expect(manageBtn).toHaveTextContent(/manage billing/i);

    fireEvent.click(manageBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/billing/portal', {});
    });

    expect(redirectSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  test('Premium user: clicking Manage Billing posts portal request', async () => {
    const redirectSpy = jest.fn();

    mockCurrentUser = { plan: 'PREMIUM' };

    mockPost.mockResolvedValueOnce({
      data: { portalUrl: 'https://billing.example/portal' },
    });

    render(<UpgradePage redirect={redirectSpy} />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');

    expect(manageBtn).toHaveTextContent(/manage billing/i);

    fireEvent.click(manageBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/billing/portal', {});
    });

    await waitFor(() => {
      expect(redirectSpy).toHaveBeenCalledWith('https://billing.example/portal');
    });
  });

  test('PREMIUM user: clicking Manage Billing sets button to Opening', async () => {
    const redirectSpy = jest.fn();

    mockCurrentUser = { plan: 'PREMIUM' };

    let resolvePortal;

    mockPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePortal = resolve;
      })
    );

    render(<UpgradePage redirect={redirectSpy} />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');

    fireEvent.click(manageBtn);

    const openingBtn = within(premiumMonthlyCard).getByRole('button');

    expect(openingBtn).toHaveTextContent(/opening/i);
    expect(openingBtn).toHaveAttribute('aria-busy', 'true');

    resolvePortal({ data: { portalUrl: 'https://y' } });

    await waitFor(() => {
      expect(redirectSpy).toHaveBeenCalledWith('https://y');
    });
  });

  test('Free card button is disabled for Free users', async () => {
    render(<UpgradePage />);

    await screen.findByTestId('plan-free');

    const freeCard = screen.getByTestId('plan-free');
    const btn = within(freeCard).getByRole('button');

    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/current plan/i);
  });
});