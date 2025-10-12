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
const patchMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { patch: (...a) => patchMock(...a) },
}));

// PremiumGuard passthrough
jest.mock('@/components/PremiumGuard', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="premium-guard">{children}</div>,
}));

// Premium status hook
let isPremiumFlag = false;
jest.mock('@/hooks/useIsPremium', () => ({
  __esModule: true,
  default: () => isPremiumFlag,
}));

// Router navigate
const navigateMock = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => navigateMock,
}));

// User context (mutable source so we can rehydrate between renders)
let currentUserState;
const setCurrentUserMock = jest.fn();
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: currentUserState,
    setCurrentUser: setCurrentUserMock,
  }),
}));

// SUT
import PrivacyToggles from './PrivacyToggles';

// Helpers
function renderWithUser(user = {}) {
  currentUserState = user;
  setCurrentUserMock.mockReset();
  patchMock.mockReset();
  navigateMock.mockReset();
  return render(<PrivacyToggles />);
}

function getSwitch(labelRegex) {
  // return the input by aria-label
  return screen.getByRole('checkbox', { name: labelRegex });
}

describe('PrivacyToggles', () => {
  beforeEach(() => {
    isPremiumFlag = false;
    // silence alert popups in test env
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  test('initializes from currentUser and updates when currentUser changes', () => {
    renderWithUser({
      showReadReceipts: false,
      allowExplicitContent: true,
      privacyBlurEnabled: false,
      privacyHoldToReveal: true, // will be shown but disabled (since blur off)
      notifyOnCopy: false,
    });

    expect(getSwitch(/Send read receipts/i)).not.toBeChecked();
    expect(getSwitch(/Allow explicit content/i)).toBeChecked();
    expect(getSwitch(/Blur chat content until focus/i)).not.toBeChecked();
    // Hold to reveal reflects state but disabled because blur is off
    const hold = getSwitch(/Hold to reveal/i);
    expect(hold).toBeChecked();
    expect(screen.getByTestId('switch-Hold to reveal')).toHaveAttribute('aria-disabled', 'true');

    // Simulate context change: toggle some flags in currentUser and re-render
    currentUserState = {
      showReadReceipts: true,
      allowExplicitContent: false,
      privacyBlurEnabled: true,
      privacyHoldToReveal: false,
      notifyOnCopy: true,
    };
    render(<PrivacyToggles />); // simple re-render to trigger useEffect with new currentUser

    expect(getSwitch(/Send read receipts/i)).toBeChecked();
    expect(getSwitch(/Allow explicit content/i)).not.toBeChecked();
    expect(getSwitch(/Blur chat content until focus/i)).toBeChecked();
    expect(getSwitch(/Hold to reveal/i)).not.toBeChecked();
    // with blur on, hold-to-reveal is enabled
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

    // Toggle "Send read receipts" ON
    patchMock.mockResolvedValueOnce({ data: { showReadReceipts: true, serverEcho: 1 } });
    const rr = getSwitch(/Send read receipts/i);
    expect(rr).not.toBeChecked();
    fireEvent.click(rr);

    // Optimistic update reflects immediately
    expect(rr).toBeChecked();

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/users/me', { showReadReceipts: true }));

    // setCurrentUser called with updater function that merges server response
    expect(setCurrentUserMock).toHaveBeenCalledTimes(1);
    const updater = setCurrentUserMock.mock.calls[0][0];
    expect(typeof updater).toBe('function');
    const merged = updater({ id: 1, showReadReceipts: false });
    expect(merged).toEqual(expect.objectContaining({ id: 1, showReadReceipts: true, serverEcho: 1 }));
  });

  test('reverts on failure and alerts user', async () => {
    renderWithUser({
      allowExplicitContent: false,
    });

    patchMock.mockRejectedValueOnce(new Error('nope'));

    const explicit = getSwitch(/Allow explicit content/i);
    expect(explicit).not.toBeChecked();

    fireEvent.click(explicit); // optimistic -> becomes checked
    expect(explicit).toBeChecked();

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/users/me', { allowExplicitContent: true }));

    // After failure, state should revert to currentUser (false)
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

    // Initially disabled
    expect(screen.getByTestId('switch-Hold to reveal')).toHaveAttribute('aria-disabled', 'true');

    // Enable blur -> hold becomes enabled
    patchMock.mockResolvedValueOnce({ data: { privacyBlurEnabled: true } });
    fireEvent.click(blur);
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/users/me', { privacyBlurEnabled: true }));
    expect(screen.getByTestId('switch-Hold to reveal')).toHaveAttribute('aria-disabled', 'false');

    // Toggle hold on
    patchMock.mockResolvedValueOnce({ data: { privacyHoldToReveal: true } });
    fireEvent.click(hold);
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/users/me', { privacyHoldToReveal: true }));
    expect(hold).toBeChecked();
  });

  test('Premium-only toggle navigates to upgrade when not premium', () => {
    isPremiumFlag = false;
    renderWithUser({});

    const premiumToggle = getSwitch(/Auto-translate all incoming messages \(Premium\)/i);
    fireEvent.click(premiumToggle);

    expect(navigateMock).toHaveBeenCalledWith('/settings/upgrade');
  });

  test('Premium-only toggle does not navigate when premium', () => {
    isPremiumFlag = true;
    renderWithUser({});

    const premiumToggle = getSwitch(/Auto-translate all incoming messages \(Premium\)/i);
    fireEvent.click(premiumToggle);

    expect(navigateMock).not.toHaveBeenCalled();
    // (No patch occurs yet because implementation is commented out.)
    expect(patchMock).not.toHaveBeenCalled();
  });
});
