import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mocks ----

// Mantine core (simple, prop-driven stubs)
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Stack = ({ children }) => <div data-testid="stack">{children}</div>;
  const Group = ({ children }) => <div data-testid="group">{children}</div>;
  const Text  = ({ children, ...rest }) => <div data-testid="text" {...rest}>{children}</div>;

  const Switch = ({ label, description, checked, disabled, onChange }) => (
    <label data-testid={`switch-${label}`} aria-disabled={disabled ? 'true' : 'false'}>
      <input
        type="checkbox"
        role="checkbox"
        aria-label={label}
        aria-description={description || ''}
        checked={!!checked}
        disabled={!!disabled}
        onChange={(e) => onChange?.(e)}
      />
      {label}
    </label>
  );

  return { __esModule: true, Stack, Switch, Group, Text };
});

// axios client
const mockPatch = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { patch: (...a) => mockPatch(...a) },
}));

// PremiumGuard passthrough
jest.mock('@/components/PremiumGuard', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="premium-guard">{children}</div>,
}));

// Premium status hook
let mockIsPremiumFlag = false;
jest.mock('@/hooks/useIsPremium', () => ({
  __esModule: true,
  default: () => mockIsPremiumFlag,
}));

// Router navigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

// User context (mutable mocks; names start with "mock" to satisfy Jest)
let mockCurrentUserState;
const mockSetCurrentUser = jest.fn();
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: mockCurrentUserState,
    setCurrentUser: mockSetCurrentUser,
  }),
}));

// SUT (real file lives under features/settings)
import PrivacyToggles from '../settings/PrivacyToggles';

// Helpers
function renderWithUser(user = {}) {
  mockCurrentUserState = user;
  mockSetCurrentUser.mockReset();
  mockPatch.mockReset();
  mockNavigate.mockReset();
  return render(<PrivacyToggles />);
}

function getSwitch(labelRegex) {
  return screen.getByRole('checkbox', { name: labelRegex });
}

describe('PrivacyToggles', () => {
  beforeEach(() => {
    mockIsPremiumFlag = false;
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  test('initializes from currentUser and updates when currentUser changes', () => {
   const { rerender } = renderWithUser({
      showReadReceipts: false,
      allowExplicitContent: true,
      privacyBlurEnabled: false,
      privacyHoldToReveal: true, // will be shown but disabled (since blur off)
      notifyOnCopy: false,
    });

    expect(getSwitch(/Send read receipts/i)).not.toBeChecked();
    expect(getSwitch(/Allow explicit content/i)).toBeChecked();
    expect(getSwitch(/Blur chat content until focus/i)).not.toBeChecked();
    const hold = getSwitch(/Hold to reveal/i);
    expect(hold).toBeChecked();
    expect(screen.getByTestId('switch-Hold to reveal')).toHaveAttribute('aria-disabled', 'true');

    // Simulate context change
    mockCurrentUserState = {
      showReadReceipts: true,
      allowExplicitContent: false,
      privacyBlurEnabled: true,
      privacyHoldToReveal: false,
      notifyOnCopy: true,
    };
    rerender(<PrivacyToggles />); // re-render to pick up new context

    expect(getSwitch(/Send read receipts/i)).toBeChecked();
    expect(getSwitch(/Allow explicit content/i)).not.toBeChecked();
    expect(getSwitch(/Blur chat content until focus/i)).toBeChecked();
    expect(getSwitch(/Hold to reveal/i)).not.toBeChecked();
    expect(screen.getByTestId('switch-Hold to reveal')).toHaveAttribute('aria-disabled', 'false');
    expect(getSwitch(/Notify me if someone copies my message/i)).toBeChecked();
  });

  test('optimistic patch and setCurrentUser merge on success', async () => {
    renderWithUser({
      showReadReceipts: false,
      allowExplicitContent: false,
      privacyBlurEnabled: false,
      privacyHoldToReveal: false,
      notifyOnCopy: false,
    });

    mockPatch.mockResolvedValueOnce({ data: { showReadReceipts: true, serverEcho: 1 } });
    const rr = getSwitch(/Send read receipts/i);
    expect(rr).not.toBeChecked();
    fireEvent.click(rr);

    expect(rr).toBeChecked();

    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/users/me', { showReadReceipts: true }));

    expect(mockSetCurrentUser).toHaveBeenCalledTimes(1);
    const updater = mockSetCurrentUser.mock.calls[0][0];
    expect(typeof updater).toBe('function');
    const merged = updater({ id: 1, showReadReceipts: false });
    expect(merged).toEqual(expect.objectContaining({ id: 1, showReadReceipts: true, serverEcho: 1 }));
  });

  test('reverts on failure and alerts user', async () => {
    renderWithUser({ allowExplicitContent: false });

    mockPatch.mockRejectedValueOnce(new Error('nope'));

    const explicit = getSwitch(/Allow explicit content/i);
    expect(explicit).not.toBeChecked();

    fireEvent.click(explicit); // optimistic
    expect(explicit).toBeChecked();

    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/users/me', { allowExplicitContent: true }));

    await waitFor(() => expect(explicit).not.toBeChecked());
    expect(window.alert).toHaveBeenCalled();
  });

  test('Hold to reveal disabled unless Blur is enabled', async () => {
    renderWithUser({
      privacyBlurEnabled: false,
      privacyHoldToReveal: false,
    });

    const blur = getSwitch(/Blur chat content until focus/i);
    const hold = getSwitch(/Hold to reveal/i);

    expect(screen.getByTestId('switch-Hold to reveal')).toHaveAttribute('aria-disabled', 'true');

    mockPatch.mockResolvedValueOnce({ data: { privacyBlurEnabled: true } });
    fireEvent.click(blur);
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/users/me', { privacyBlurEnabled: true }));
    expect(screen.getByTestId('switch-Hold to reveal')).toHaveAttribute('aria-disabled', 'false');

    mockPatch.mockResolvedValueOnce({ data: { privacyHoldToReveal: true } });
    fireEvent.click(hold);
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/users/me', { privacyHoldToReveal: true }));
    expect(hold).toBeChecked();
  });

  test('Premium-only toggle navigates to upgrade when not premium', () => {
    mockIsPremiumFlag = false;
    renderWithUser({});

    const premiumToggle = getSwitch(/Auto-translate all incoming messages \(Premium\)/i);
    fireEvent.click(premiumToggle);

    expect(mockNavigate).toHaveBeenCalledWith('/settings/upgrade');
  });

  test('Premium-only toggle does not navigate when premium', () => {
    mockIsPremiumFlag = true;
    renderWithUser({});

    const premiumToggle = getSwitch(/Auto-translate all incoming messages \(Premium\)/i);
    fireEvent.click(premiumToggle);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
