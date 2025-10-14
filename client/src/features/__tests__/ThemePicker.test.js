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
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

// API
const mockGet = jest.fn();
const mockPatch = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    patch: (...a) => mockPatch(...a),
  },
}));

// Entitlements
const mockUseEntitlements = jest.fn();
jest.mock('@/hooks/useEntitlements', () => ({
  __esModule: true,
  default: () => mockUseEntitlements(),
}));

// PremiumGuard passthrough
jest.mock('@/components/PremiumGuard', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="premium-guard">{children}</div>,
}));

// SUT
import ThemePicker from '../settings/ThemePicker';

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
  mockNavigate.mockReset();
  mockGet.mockReset();
  mockPatch.mockReset();
  mockUseEntitlements.mockReset();

  mockUseEntitlements.mockReturnValue({ entitlements: { plan: entitlementsPlan }, loading: false });
  mockGet.mockResolvedValueOnce({ data: server });
}

describe('ThemePicker', () => {
  beforeEach(() => {
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  test('renders nothing while entitlements are loading', () => {
    mockUseEntitlements.mockReturnValue({ entitlements: null, loading: true });
    // GET is still called by useEffect but we'll ignore since component returns null first
    mockGet.mockResolvedValueOnce({ data: serverCatalog });

    const { container } = render(<ThemePicker />);
    expect(container).toBeEmptyDOMElement();
  });

  test('bootstraps options and current value; shows premium lock banner for non-premium', async () => {
    baseArrange({ entitlementsPlan: 'FREE' });
    render(<ThemePicker />);

    // Wait for GET to resolve and Select to show current
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/features/themes');
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

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    mockPatch.mockResolvedValueOnce({ data: { ok: true } });

    // Choose "light"
    fireEvent.click(screen.getByTestId('opt-light'));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/features/theme', { theme: 'light' });
      expect(screen.getByTestId('select')).toHaveAttribute('data-value', 'light');
    });

    // No navigation for free choice
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('selecting a premium theme while not premium navigates to /settings/upgrade', async () => {
    // Make premium option clickable in UI but keep user FREE so navigation happens
    baseArrange({
      entitlementsPlan: 'FREE',
      server: { ...serverCatalog, canUsePremium: true },
    });
    render(<ThemePicker />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    // Ensure the premium option is clickable (not disabled)
    expect(screen.getByTestId('opt-neon')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('opt-neon'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/settings/upgrade'));
    expect(mockPatch).not.toHaveBeenCalled();
  });

  test('saveTheme error: 402 or PREMIUM_REQUIRED -> navigate to upgrade', async () => {
    // Ensure premium option is clickable
    baseArrange({ entitlementsPlan: 'PREMIUM', server: { ...serverCatalog, canUsePremium: true } });
    render(<ThemePicker />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    // Simulate server enforcing paywall anyway
    mockPatch.mockRejectedValueOnce({ response: { status: 402 } });
    fireEvent.click(screen.getByTestId('opt-neon'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/settings/upgrade'));

    // PREMIUM_REQUIRED code path
    mockNavigate.mockReset();
    mockPatch.mockRejectedValueOnce({ response: { data: { code: 'PREMIUM_REQUIRED' } } });
    fireEvent.click(screen.getByTestId('opt-neon'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/settings/upgrade'));
  });

  test('saveTheme error: 409 -> schema guidance alert', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' });
    render(<ThemePicker />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    mockPatch.mockRejectedValueOnce({ response: { status: 409 } });
    fireEvent.click(screen.getByTestId('opt-dark')); // still invokes saveTheme with 'dark'

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/Theme field not found/i)
    ));
  });

  test('saveTheme error: generic -> generic alert', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' });
    render(<ThemePicker />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    mockPatch.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByTestId('opt-dark'));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to update theme/i)
    ));
  });

  test('no premium lock banner when entitlements plan is PREMIUM', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' });
    render(<ThemePicker />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByTestId('alert')).toBeNull();
  });
});
