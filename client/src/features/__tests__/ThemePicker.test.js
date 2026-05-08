import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ---- Mocks ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Stack = ({ children }) => <div data-testid="stack">{children}</div>;
  const Group = ({ children }) => <div data-testid="group">{children}</div>;
  const Text = ({ children, ...rest }) => (
    <div data-testid="text" {...rest}>
      {children}
    </div>
  );
  const Alert = ({ children, ...rest }) => (
    <div data-testid="alert" {...rest}>
      {children}
    </div>
  );

  const Select = ({ label, data, value, onChange }) => (
    <div data-testid="select" data-label={label} data-value={value}>
      {(data || []).flatMap((group, groupIndex) =>
        (group.items || []).map((opt, optIndex) => (
          <button
            key={`${groupIndex}-${optIndex}-${opt.value}`}
            data-testid={`opt-${opt.value}`}
            type="button"
            onClick={() => onChange?.(opt.value)}
            disabled={!!opt.disabled}
          >
            {group.group}:{opt.label}
          </button>
        ))
      )}
    </div>
  );

  const Button = ({ children, onClick, disabled }) => (
    <button type="button" onClick={onClick} disabled={!!disabled}>
      {children}
    </button>
  );

  return {
    __esModule: true,
    Group,
    Select,
    Button,
    Stack,
    Text,
    Alert,
  };
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
    get: (...args) => mockGet(...args),
    patch: (...args) => mockPatch(...args),
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
  current: { theme: 'dawn' },
  canUsePremium: false,
  catalog: [
    { id: 'dawn', premium: false },
    { id: 'midnight', premium: false },
    { id: 'neon', premium: true },
  ],
};

function baseArrange({
  entitlementsPlan = 'FREE',
  server = serverCatalog,
} = {}) {
  mockNavigate.mockReset();
  mockGet.mockReset();
  mockPatch.mockReset();
  mockUseEntitlements.mockReset();

  mockUseEntitlements.mockReturnValue({
    entitlements: { plan: entitlementsPlan },
    loading: false,
  });

  mockGet.mockResolvedValueOnce({ data: server });
}

describe('ThemePicker', () => {
  beforeEach(() => {
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    window.alert.mockRestore?.();
  });

  test('renders nothing while entitlements are loading', () => {
    mockUseEntitlements.mockReturnValue({
      entitlements: null,
      loading: true,
    });

    mockGet.mockResolvedValueOnce({ data: serverCatalog });

    const { container } = render(<ThemePicker />);

    expect(container).toBeEmptyDOMElement();
  });

  test('bootstraps options and current value; shows premium lock banner for non-premium', async () => {
    baseArrange({ entitlementsPlan: 'FREE' });

    render(<ThemePicker />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/features/themes');
    });

    await waitFor(() => {
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'dawn'
      );
    });

    expect(screen.getByTestId('opt-dawn')).toBeInTheDocument();
    expect(screen.getByTestId('opt-midnight')).toBeInTheDocument();

    expect(screen.getByTestId('opt-neon')).toHaveTextContent(
      /Premium:.*⭐\s*neon/i
    );

    expect(screen.getByTestId('opt-neon')).toBeDisabled();

    expect(screen.getByTestId('alert')).toHaveTextContent(
      /Premium themes are locked/i
    );
  });

  test('selecting a free theme patches /users/me and updates current', async () => {
    baseArrange({ entitlementsPlan: 'FREE' });

    render(<ThemePicker />);

    await waitFor(() => {
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'dawn'
      );
    });

    mockPatch.mockResolvedValueOnce({ data: { ok: true } });

    fireEvent.click(screen.getByTestId('opt-midnight'));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/users/me', {
        theme: 'midnight',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'midnight'
      );
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('selecting a premium theme while not premium navigates to /settings/upgrade', async () => {
    baseArrange({
      entitlementsPlan: 'FREE',
      server: {
        ...serverCatalog,
        canUsePremium: true,
      },
    });

    render(<ThemePicker />);

    await waitFor(() => {
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'dawn'
      );
    });

    expect(screen.getByTestId('opt-neon')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('opt-neon'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/settings/upgrade');
    });

    expect(mockPatch).not.toHaveBeenCalled();
  });

  test('selecting a premium theme as premium patches /users/me', async () => {
    baseArrange({
      entitlementsPlan: 'PREMIUM',
      server: {
        ...serverCatalog,
        canUsePremium: true,
      },
    });

    render(<ThemePicker />);

    await waitFor(() => {
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'dawn'
      );
    });

    mockPatch.mockResolvedValueOnce({ data: { ok: true } });

    fireEvent.click(screen.getByTestId('opt-neon'));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/users/me', {
        theme: 'neon',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'neon'
      );
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('saveTheme error shows generic alert and does not navigate', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' });

    render(<ThemePicker />);

    await waitFor(() => {
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'dawn'
      );
    });

    mockPatch.mockRejectedValueOnce(new Error('boom'));

    fireEvent.click(screen.getByTestId('opt-midnight'));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Failed to update theme.');
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('no premium lock banner when entitlements plan is PREMIUM', async () => {
    baseArrange({ entitlementsPlan: 'PREMIUM' });

    render(<ThemePicker />);

    await waitFor(() => {
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'dawn'
      );
    });

    expect(screen.queryByTestId('alert')).toBeNull();
  });
});