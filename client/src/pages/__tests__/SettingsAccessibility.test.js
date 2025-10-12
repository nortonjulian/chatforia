import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// -------- Mocks --------

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
        onChange={(e) => onChange?.({ currentTarget: { checked: e.target.checked }, stopPropagation: () => {} })}
        style={style}
      />
    </label>
  );
  return { __esModule: true, Title, Switch };
});

// PremiumGuard passthrough
jest.mock('../components/PremiumGuard', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="premium-guard">{children}</div>,
}));

// Context: we’ll override currentUser between tests
let currentUserVal = null;
jest.mock('../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: currentUserVal }),
}));

// axios client
const patchMock = jest.fn();
jest.mock('../api/axiosClient', () => ({
  __esModule: true,
  default: {
    patch: (...a) => patchMock(...a),
  },
}));

// SUT
import SettingsAccessibility from './SettingsAccessibility';

// Helpers
const setNavigatorVibrate = (present) => {
  const base = {};
  if (present) base.vibrate = () => true;
  Object.defineProperty(global.navigator, 'vibrate', {
    configurable: true,
    value: present ? base.vibrate : undefined,
    writable: true,
  });
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

describe('SettingsAccessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Defaults: vib supported, reduceMotion false
    setNavigatorVibrate(true);
    setMatchMedia(false);
  });

  test('shows error view when no user is present', () => {
    currentUserVal = null;
    render(<SettingsAccessibility />);

    expect(screen.getByTestId('title')).toHaveTextContent(/Accessibility & Alerts/i);
    expect(screen.getByText(/Failed to load settings/i)).toBeInTheDocument();
  });

  test('renders with user and derives ui font class; selecting a new font saves and updates class', async () => {
    currentUserVal = { a11yUiFont: 'lg' }; // initial
    render(<SettingsAccessibility />);

    const root = screen.getByText(/Options to make Chatforia easier/i).closest('div').parentElement;
    // root is the container with font class applied (p-4 max-w-3xl ...)
    expect(root.className).toMatch(/text-lg/);

    // Change the "Interface font size" select to xl
    const ifaceSelect = screen.getByLabelText(/Interface font size/i).querySelector('select');
    const inFlight = deferred();
    patchMock.mockReturnValueOnce(inFlight.promise); // keep it pending to see "Saving…"

    // Change to "xl"
    fireEvent.change(ifaceSelect, { target: { value: 'xl' } });
    // Shows saving while pending
    expect(screen.getByText(/Saving…/i)).toBeInTheDocument();

    // Server responds with user echoing new font
    inFlight.resolve({ data: { user: { a11yUiFont: 'xl' } } });
    await act(async () => { await inFlight.promise; });

    await waitFor(() => {
      // Saved indicator text flips back
      expect(screen.getByText(/Changes are saved instantly\./i)).toBeInTheDocument();
      // Font class updated
      expect(root.className).toMatch(/text-xl/);
    });

    expect(patchMock).toHaveBeenCalledWith('/users/me/a11y', { a11yUiFont: 'xl' });
  });

  test('toggling Visual alerts switch sends PATCH with correct field/value', async () => {
    currentUserVal = { a11yVisualAlerts: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Visual alerts for messages & calls/i });
    expect(sw).not.toBeChecked();

    patchMock.mockResolvedValueOnce({ data: { user: { a11yVisualAlerts: true } } });
    fireEvent.click(sw);

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/users/me/a11y', { a11yVisualAlerts: true });
    });
  });

  test('Live captions: 402 error surfaces "Premium required." under that control', async () => {
    currentUserVal = { a11yLiveCaptions: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Enable live captions during calls/i });
    patchMock.mockRejectedValueOnce({ response: { status: 402 }, message: 'boom' });

    fireEvent.click(sw);

    // Field-level error shows beneath the section
    await waitFor(() => {
      expect(screen.getByText(/Premium required\./i)).toBeInTheDocument();
    });
  });

  test('Vibrate switch disabled when navigator.vibrate is not supported', () => {
    setNavigatorVibrate(false);
    currentUserVal = {};
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Vibrate on new messages/i });
    expect(sw).toBeDisabled();
  });

  test('Flash screen on incoming call disabled when prefers-reduced-motion is true', () => {
    setMatchMedia(true); // reduce motion
    currentUserVal = {};
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Flash screen on incoming call/i });
    expect(sw).toBeDisabled();
  });

  test('401 error displays "Please sign in again." for the specific field', async () => {
    currentUserVal = { a11yVibrate: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', { name: /Vibrate on new messages/i });
    patchMock.mockRejectedValueOnce({ response: { status: 401 }, message: 'unauth' });

    fireEvent.click(sw);

    await waitFor(() => {
      expect(screen.getByText(/Please sign in again\./i)).toBeInTheDocument();
    });
  });
});
