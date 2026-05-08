/** @jest-environment jsdom */

import { act } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

// ---- Patch window.location ONCE so href redirects are testable ----
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
      ml,
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

  const Accordion = ({ children }) => (
    <div data-testid="accordion">{children}</div>
  );
  Accordion.Item = ({ children }) => <div>{children}</div>;
  Accordion.Control = ({ children }) => (
    <button type="button">{children}</button>
  );
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
    resetHref('');

    for (const key of [...mockSearchParams.keys()]) {
      mockSearchParams.delete(key);
    }
  });

  afterAll(() => {
    window.location = originalLocation;
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
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockPost.mockRejectedValueOnce({
      response: { data: { message: 'Stripe not configured' } },
    });

    render(<UpgradePage />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');

    await act(async () => {
      fireEvent.click(upgradeMonthlyBtn);
    });

    expect(mockPost).toHaveBeenCalledWith('/billing/checkout', {
      plan: 'PREMIUM_MONTHLY',
    });

    expect(assignedHref).toBe('');

    errorSpy.mockRestore();
  });

  test('FREE user: clicking Upgrade Monthly posts checkout', async () => {
    mockPost.mockResolvedValueOnce({
      data: { checkoutUrl: 'https://pay.example/checkout' },
    });

    render(<UpgradePage />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');

    expect(upgradeMonthlyBtn).toHaveTextContent(/upgrade monthly/i);

    await act(async () => {
      fireEvent.click(upgradeMonthlyBtn);
    });

    expect(mockPost).toHaveBeenCalledWith('/billing/checkout', {
      plan: 'PREMIUM_MONTHLY',
    });

    expect(assignedHref).toBe('https://pay.example/checkout');
  });

  test('FREE user: clicking Upgrade Monthly sets button to Redirecting', async () => {
    let resolveCheckout;

    mockPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheckout = resolve;
      })
    );

    render(<UpgradePage />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const upgradeMonthlyBtn = within(premiumMonthlyCard).getByRole('button');

    fireEvent.click(upgradeMonthlyBtn);

    const redirectingBtn = within(premiumMonthlyCard).getByRole('button');

    expect(redirectingBtn).toHaveTextContent(/redirecting/i);
    expect(redirectingBtn).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolveCheckout({ data: { checkoutUrl: 'https://x' } });
    });

    expect(assignedHref).toBe('https://x');
  });

  test('Premium user: portal error handled', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockCurrentUser = { plan: 'PREMIUM', id: 1 };

    mockPost.mockRejectedValueOnce(new Error('network down'));

    render(<UpgradePage />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');

    expect(manageBtn).toHaveTextContent(/manage billing/i);

    await act(async () => {
      fireEvent.click(manageBtn);
    });

    expect(mockPost).toHaveBeenCalledWith('/billing/portal', {});
    expect(assignedHref).toBe('');

    errorSpy.mockRestore();
  });

  test('Premium user: clicking Manage Billing posts portal request', async () => {
    mockCurrentUser = { plan: 'PREMIUM' };

    mockPost.mockResolvedValueOnce({
      data: { portalUrl: 'https://billing.example/portal' },
    });

    render(<UpgradePage />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');

    expect(manageBtn).toHaveTextContent(/manage billing/i);

    await act(async () => {
      fireEvent.click(manageBtn);
    });

    expect(mockPost).toHaveBeenCalledWith('/billing/portal', {});
    expect(assignedHref).toBe('https://billing.example/portal');
  });

  test('PREMIUM user: clicking Manage Billing sets button to Opening', async () => {
    mockCurrentUser = { plan: 'PREMIUM' };

    let resolvePortal;

    mockPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePortal = resolve;
      })
    );

    render(<UpgradePage />);

    await screen.findByTestId('plan-premium-monthly');

    const premiumMonthlyCard = screen.getByTestId('plan-premium-monthly');
    const manageBtn = within(premiumMonthlyCard).getByRole('button');

    fireEvent.click(manageBtn);

    const openingBtn = within(premiumMonthlyCard).getByRole('button');

    expect(openingBtn).toHaveTextContent(/opening/i);
    expect(openingBtn).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolvePortal({ data: { portalUrl: 'https://y' } });
    });

    expect(assignedHref).toBe('https://y');
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