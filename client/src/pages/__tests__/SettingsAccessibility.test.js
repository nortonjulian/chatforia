import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/* ---------------- Mocks ---------------- */

// Mantine core (only the small bits we use)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Title = ({ children, ...rest }) => <h3 data-testid="title" {...rest}>{children}</h3>;
  const Switch = ({ checked, onChange, disabled, 'aria-label': ariaLabel, style }) => (
    <label>
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        checked={!!checked}
        disabled={!!disabled}
        onChange={(e) =>
          onChange?.({ currentTarget: { checked: e.target.checked }, stopPropagation: () => {} })
        }
        style={style}
      />
    </label>
  );
  return { __esModule: true, Title, Switch };
});

// PremiumGuard passthrough (path from __tests__/ to pages/components)
jest.mock('../../components/PremiumGuard', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="premium-guard">{children}</div>,
}));

// UserContext: read currentUser from a global (allowed in factory; avoids out-of-scope var)
global.mockCurrentUser = null;
jest.mock('../../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: global.mockCurrentUser }),
}));

// axios client: define mocks inside the factory, then use the imported mock
jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    patch: jest.fn(),
  },
}));
import axiosClient from '../../api/axiosClient';

/* ---------------- SUT ---------------- */

// From __tests__/ to the page component
import SettingsAccessibility from '../SettingsAccessibility';

/* ---------------- Helpers ---------------- */

const setNavigatorVibrate = (present) => {
  // Ensure we can delete/redefine
  try {
    Object.defineProperty(global.navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: present ? function vibrate() { return true; } : undefined,
    });
  } catch {
    // ignore
  }
  if (!present) {
    // Remove the property entirely so `'vibrate' in navigator` === false
    try {
      // eslint-disable-next-line no-prototype-builtins
      if (Object.prototype.hasOwnProperty.call(global.navigator, 'vibrate')) {
        // Deleting works only if configurable
        try { delete global.navigator.vibrate; } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
};

const setMatchMedia = (matches) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      onchange: null,
      dispatchEvent: jest.fn(),
    })),
  });
};

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

/* ---------------- Tests ---------------- */

describe('SettingsAccessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Defaults: vib supported, reduceMotion false
    setNavigatorVibrate(true);
    setMatchMedia(false);
    global.mockCurrentUser = null;
  });

  test('shows error view when no user is present', () => {
    global.mockCurrentUser = null;
    render(<SettingsAccessibility />);

    expect(screen.getByTestId('title')).toHaveTextContent(/Accessibility & Alerts/i);
    expect(screen.getByText(/Failed to load settings/i)).toBeInTheDocument();
  });

  test('renders with user and derives ui font class; selecting a new font saves and updates class', async () => {
    global.mockCurrentUser = { a11yUiFont: 'lg' }; // initial
    render(<SettingsAccessibility />);

    // Grab the root container by its known class
    const root = document.querySelector('.max-w-3xl');
    expect(root).toBeTruthy();
    expect(root.className).toMatch(/text-lg/);

    // Change the "Interface font size" select to xl
    const ifaceSelect = screen.getByLabelText(/Interface font size/i); // select element itself
    const inFlight = deferred();
    axiosClient.patch.mockReturnValueOnce(inFlight.promise); // keep it pending to see "Saving…"

    fireEvent.change(ifaceSelect, { target: { value: 'xl' } });
    expect(screen.getByText(/Saving…/i)).toBeInTheDocument();

    // Server responds with user echoing new font
    inFlight.resolve({ data: { user: { a11yUiFont: 'xl' } } });
    await act(async () => { await inFlight.promise; });

    await waitFor(() => {
      expect(screen.getByText(/Changes are saved instantly\./i)).toBeInTheDocument();
      expect(root.className).toMatch(/text-xl/);
    });

    expect(axiosClient.patch).toHaveBeenCalledWith('/users/me/a11y', { a11yUiFont: 'xl' });
  });

  test('toggling Visual alerts switch sends PATCH with correct field/value', async () => {
    global.mockCurrentUser = { a11yVisualAlerts: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Visual alerts for messages & calls/i });
    expect(sw).not.toBeChecked();

    axiosClient.patch.mockResolvedValueOnce({ data: { user: { a11yVisualAlerts: true } } });
    fireEvent.click(sw);

    await waitFor(() => {
      expect(axiosClient.patch).toHaveBeenCalledWith('/users/me/a11y', { a11yVisualAlerts: true });
    });
  });

  test('Live captions: 402 error surfaces "Premium required." under that control', async () => {
    global.mockCurrentUser = { a11yLiveCaptions: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Enable live captions during calls/i });
    axiosClient.patch.mockRejectedValueOnce({ response: { status: 402 }, message: 'boom' });

    fireEvent.click(sw);

    await waitFor(() => {
      expect(screen.getByText(/Premium required\./i)).toBeInTheDocument();
    });
  });

  test('Vibrate switch disabled when navigator.vibrate is not supported', () => {
    setNavigatorVibrate(false);
    global.mockCurrentUser = {};
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Vibrate on new messages/i });
    expect(sw).toBeDisabled();
  });

  test('Flash screen on incoming call disabled when prefers-reduced-motion is true', () => {
    setMatchMedia(true); // reduce motion
    global.mockCurrentUser = {};
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Flash screen on incoming call/i });
    expect(sw).toBeDisabled();
  });

  test('401 error displays "Please sign in again." for the specific field', async () => {
    global.mockCurrentUser = { a11yVibrate: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Vibrate on new messages/i });
    axiosClient.patch.mockRejectedValueOnce({ response: { status: 401 }, message: 'unauth' });

    fireEvent.click(sw);

    await waitFor(() => {
      expect(screen.getByText(/Please sign in again\./i)).toBeInTheDocument();
    });
  });
});
