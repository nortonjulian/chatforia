import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ---- Mocks ----

// Mantine stubs (prop-inspectable, selectable)
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Stack = ({ children }) => <div data-testid="stack">{children}</div>;
  const Group = ({ children }) => <div data-testid="group">{children}</div>;
  const Text  = ({ children, ...rest }) => <div data-testid="text" {...rest}>{children}</div>;
  const Alert = ({ children, ...rest }) => <div data-testid="alert" {...rest}>{children}</div>;

  const Select = ({ label, data, value, onChange }) => (
    <div data-testid="select" data-label={label} data-value={value}>
      {/* Expose grouped options as buttons for easy clicking */}
      {(data || []).flatMap((g, gi) =>
        (g.items || []).map((opt, oi) => (
          <button
            key={`${gi}-${oi}-${opt.value}`}
            data-testid={`opt-${opt.value}`}
            onClick={() => onChange?.(opt.value)}
            disabled={!!opt.disabled}
          >
            {g.group}:{opt.label}
          </button>
        ))
      )}
    </div>
  );

  return { __esModule: true, Group, Select, Button: (p)=>null, Stack, Text, Alert };
});

// Router
const navigateMock = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => navigateMock,
}));

// API
const getMock = jest.fn();
const patchMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => getMock(...a),
    patch: (...a) => patchMock(...a),
  },
}));

// Entitlements
const useEntitlementsMock = jest.fn();
jest.mock('@/hooks/useEntitlements', () => ({
  __esModule: true,
  default: () => useEntitlementsMock(),
}));

// PremiumGuard passthrough
jest.mock('@/components/PremiumGuard', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="premium-guard">{children}</div>,
}));

// SUT
import ThemePicker from './ThemePicker';

const serverCatalog = {
  current: { theme: 'dark' },
  canUsePremium: false,
  catalog: [
    { id: 'light', premium: false },
    { id: 'dark',  premium: false },
    { id: 'neon',  premium: true },
  ],
};

function baseArrange({ entitlementsPlan = 'FREE', server = serverCatalog } = {}) {
  navigateMock.mockReset();
  getMock.mockReset();
  patchMock.mockReset();
  useEntitlementsMock.mockReset();

  useEntitlementsMock.mockReturnValue({ entitlements: { plan: entitlementsPlan }, loading: false });
  getMock.mockResolvedValueOnce({ data: server });
}

describe('ThemePicker', () => {
  beforeEach(() => {
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  test('renders nothing while entitlements are loading', () => {
    useEntitlementsMock.mockReturnValue({ entitlements: null, loading: true });
    // GET is still called by useEffect but we'll ignore since component returns null first
    getMock.mockResolvedValueOnce({ data: serverCatalog });

    const { container } = render(<ThemePicker />);
    expect(container).toBeEmptyDOMElement();
  });

  test('bootstraps options and current value; shows premium lock banner for non-premium', async () => {
    baseArrange({ entitlementsPlan: 'FREE' });
    render(<ThemePicker />);

    // Wait for GET to resolve and Select to show current
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/features/themes');
      expect(screen.getByTestId('select')).toHaveAttribute('data-value', 'dark');
    });

    // Options should include grouped Free and Premium with star label for premium option
    expect(screen.getByTestId('opt-light')).toBeInTheDocument();
    expect(screen.getByTestId('opt-dark')).toBeInTheDocument();
    expect(screen.getByTestId('opt-neon')).toHaveTextContent(/Premium:.*⭐\s*neon/i);

    // Since entitlements plan is FREE, the banner renders
    expect(screen.getByTestId('alert')).toHaveTextContent(/Premium themes are locked/i);
  });

  test('selecting a free theme patches and updates current', async () => {
    baseArrange({ entitlementsPlan: 'FREE' });
    render(<ThemePicker />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    patchMock.mockResolvedValueOnce({ data: { ok: true } });

    // Choose "light"
    fireEvent.click(screen.getByTestId('opt-light'));

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/features/theme', { theme: 'light' });
      expect(screen.getByTestId('select')).toHaveAttribute('data-value', 'light');
    });

    // No navigation for free choice
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('selecting a premium theme while not premium navigates to /settings/upgrade', async () => {
    baseArrange({ entitlementsPlan: 'FREE' });
    render(<ThemePicker />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('opt-neon'));

    expect(navigateMock).toHaveBeenCalledWith('/settings/upgrade');
    expect(patchMock).not.toHaveBeenCalled();
  });

  test('saveTheme error: 402 or PREMIUM_REQUIRED -> navigate to upgrade', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' }); // user is premium in entitlements
    render(<ThemePicker />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    // Simulate server enforcing paywall anyway
    patchMock.mockRejectedValueOnce({ response: { status: 402 } });
    fireEvent.click(screen.getByTestId('opt-neon'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/settings/upgrade'));

    // PREMIUM_REQUIRED code path
    navigateMock.mockReset();
    patchMock.mockRejectedValueOnce({ response: { data: { code: 'PREMIUM_REQUIRED' } } });
    fireEvent.click(screen.getByTestId('opt-neon'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/settings/upgrade'));
  });

  test('saveTheme error: 409 -> schema guidance alert', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' });
    render(<ThemePicker />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    patchMock.mockRejectedValueOnce({ response: { status: 409 } });
    fireEvent.click(screen.getByTestId('opt-dark')); // still invokes saveTheme with 'dark'

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/Theme field not found/i)
    ));
  });

  test('saveTheme error: generic -> generic alert', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' });
    render(<ThemePicker />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    patchMock.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByTestId('opt-dark'));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to update theme/i)
    ));
  });

  test('no premium lock banner when entitlements plan is PREMIUM', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' });
    render(<ThemePicker />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByTestId('alert')).toBeNull();
  });
});
