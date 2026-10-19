import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/* ---------------- Mocks ---------------- */

// Mantine core (only the small bits we use)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Title = ({ children, ...rest }) => (
    <h3 data-testid="title" {...rest}>
      {children}
    </h3>
  );
  const Switch = ({ checked, onChange, disabled, 'aria-label': ariaLabel, style }) => (
    <label>
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        checked={!!checked}
        disabled={!!disabled}
        onChange={(e) =>
          onChange?.({
            currentTarget: { checked: e.target.checked },
            stopPropagation: () => {},
          })
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
  useUser: () => ({ currentUser: global.mockCurrentUser, setCurrentUser: global.mockSetCurrentUser }),
}));

// i18n stub so useTranslation() doesn't require a real i18next instance
jest.mock('react-i18next', () => {
  const mockT = (key, defaultStr) => global.mockTranslations?.[key] ?? defaultStr ?? key; // stable reference
  return {
    __esModule: true,
    useTranslation: () => ({
      t: mockT,
    }),
  };
});

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
      value: present
        ? function vibrate() {
            return true;
          }
        : undefined,
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
        try {
          delete global.navigator.vibrate;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
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
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
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
    global.mockSetCurrentUser = jest.fn((update) => {
      global.mockCurrentUser = update(global.mockCurrentUser);
    });
    document.documentElement.style.fontSize = '';
    document.documentElement.removeAttribute('data-a11y-ui-font');
  });

  test('shows error view when no user is present', () => {
    global.mockCurrentUser = null;
    render(<SettingsAccessibility />);

    expect(screen.getByTestId('title')).toHaveTextContent(/Accessibility & Alerts/i);
    expect(screen.getByText(/Failed to load settings/i)).toBeInTheDocument();
  });

  test('selecting a font immediately scales the interface and saves shared account state', async () => {
    global.mockCurrentUser = { a11yUiFont: 'lg' }; // initial
    render(<SettingsAccessibility />);

    // Grab the root container by its known class
    const root = document.querySelector('.max-w-3xl');
    expect(root).toBeTruthy();

    // Change the "Interface font size" select to xl
    const ifaceSelect = screen.getByLabelText(/Interface font size/i); // select element itself
    const inFlight = deferred();
    axiosClient.patch.mockReturnValueOnce(inFlight.promise); // keep it pending to see "Saving…"

    fireEvent.change(ifaceSelect, { target: { value: 'xl' } });
    expect(document.documentElement.style.fontSize).toBe('125%');
    expect(ifaceSelect).toBeDisabled();
    expect(screen.getByText(/Saving…/i)).toBeInTheDocument();

    // Server responds with user echoing new font
    inFlight.resolve({ data: { user: { a11yUiFont: 'xl' } } });
    await act(async () => {
      await inFlight.promise;
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Changes are saved instantly\./i)
      ).toBeInTheDocument();
      expect(document.documentElement.style.fontSize).toBe('125%');
      expect(global.mockCurrentUser.a11yUiFont).toBe('xl');
      expect(ifaceSelect).not.toBeDisabled();
    });

    expect(axiosClient.patch).toHaveBeenCalledWith('/users/me/a11y', {
      a11yUiFont: 'xl',
    });
  });

  test('profile rerender and settings remount keep the acknowledged size', async () => {
    global.mockCurrentUser = { id: 68, a11yUiFont: 'md', a11yCaptionFont: 'sm', publicKey: 'keep-key' };
    axiosClient.patch.mockResolvedValueOnce({ data: { user: { id: 68, a11yUiFont: 'xl' } } });
    const { rerender, unmount } = render(<SettingsAccessibility />);
    fireEvent.change(screen.getByLabelText(/Interface font size/i), { target: { value: 'xl' } });
    await waitFor(() => expect(global.mockCurrentUser.a11yUiFont).toBe('xl'));
    global.mockCurrentUser = { ...global.mockCurrentUser, username: 'papi' };
    rerender(<SettingsAccessibility />);
    expect(screen.getByLabelText(/Interface font size/i)).toHaveValue('xl');
    expect(global.mockCurrentUser).toMatchObject({ a11yCaptionFont: 'sm', publicKey: 'keep-key' });
    unmount();
    render(<SettingsAccessibility />);
    expect(screen.getByLabelText(/Interface font size/i)).toHaveValue('xl');
    expect(document.documentElement.style.fontSize).toBe('125%');
  });

  test('failed save rolls back both preview and selection', async () => {
    global.mockCurrentUser = { id: 68, a11yUiFont: 'md' };
    axiosClient.patch.mockRejectedValueOnce({ response: { status: 403 } });
    render(<SettingsAccessibility />);
    fireEvent.change(screen.getByLabelText(/Interface font size/i), { target: { value: 'xl' } });
    await waitFor(() => expect(screen.getByText('Not allowed.')).toBeInTheDocument());
    expect(screen.getByLabelText(/Interface font size/i)).toHaveValue('md');
    expect(document.documentElement.style.fontSize).toBe('100%');
    expect(global.mockSetCurrentUser).not.toHaveBeenCalled();
  });

  test('a save response missing the changed field is not reported as saved', async () => {
    global.mockCurrentUser = { id: 68, a11yUiFont: 'md' };
    axiosClient.patch.mockResolvedValueOnce({ data: { user: { id: 68 } } });
    render(<SettingsAccessibility />);
    fireEvent.change(screen.getByLabelText(/Interface font size/i), { target: { value: 'xl' } });
    await waitFor(() => expect(screen.getByText(/did not confirm/)).toBeInTheDocument());
    expect(screen.getByLabelText(/Interface font size/i)).toHaveValue('md');
    expect(global.mockSetCurrentUser).not.toHaveBeenCalled();
  });

  test('an old save response cannot change the next account', async () => {
    global.mockCurrentUser = { id: 68, a11yUiFont: 'md' };
    const pending = deferred();
    axiosClient.patch.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<SettingsAccessibility />);
    fireEvent.change(screen.getByLabelText(/Interface font size/i), { target: { value: 'xl' } });
    global.mockCurrentUser = { id: 65, a11yUiFont: 'sm' };
    rerender(<SettingsAccessibility />);
    await act(async () => { pending.resolve({ data: { user: { id: 68, a11yUiFont: 'xl' } } }); });
    expect(screen.getByLabelText(/Interface font size/i)).toHaveValue('sm');
    expect(global.mockCurrentUser).toEqual({ id: 65, a11yUiFont: 'sm' });
    expect(global.mockSetCurrentUser).not.toHaveBeenCalled();
  });

  test('toggling Visual alerts switch sends PATCH with correct field/value', async () => {
    global.mockCurrentUser = { a11yVisualAlerts: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', {
      name: /Visual alerts for messages & calls/i,
    });
    expect(sw).not.toBeChecked();

    axiosClient.patch.mockResolvedValueOnce({
      data: { user: { a11yVisualAlerts: true } },
    });
    fireEvent.click(sw);

    await waitFor(() => {
      expect(axiosClient.patch).toHaveBeenCalledWith('/users/me/a11y', {
        a11yVisualAlerts: true,
      });
    });
  });

  test('Live captions: 402 error surfaces "Premium required." under that control', async () => {
    global.mockCurrentUser = { a11yLiveCaptions: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', {
      name: /^Enable live captions$/i,
    });
    axiosClient.patch.mockRejectedValueOnce({
      response: { status: 402 },
      message: 'boom',
    });

    fireEvent.click(sw);

    await waitFor(() => {
      expect(screen.getByText(/Premium required\./i)).toBeInTheDocument();
    });
  });

  test('Vibrate switch disabled when navigator.vibrate is not supported', () => {
    setNavigatorVibrate(false);
    global.mockCurrentUser = {};
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', {
      name: /Vibrate on new messages/i,
    });
    expect(sw).toBeDisabled();
    expect(screen.getByText(/Vibration is unavailable in this browser/i)).toBeInTheDocument();
  });

  test('Vibrate rejects a non-callable API and preserves an enabled saved preference', () => {
    Object.defineProperty(global.navigator, 'vibrate', { configurable: true, value: true });
    global.mockCurrentUser = { a11yVibrate: true };
    render(<SettingsAccessibility />);
    const sw = screen.getByRole('switch', { name: /Vibrate on new messages/i });
    expect(sw).toBeDisabled();
    expect(sw).toBeChecked();
    expect(axiosClient.patch).not.toHaveBeenCalled();
  });

  test('Vibrate describes the visible mobile-browser requirement when supported', () => {
    setNavigatorVibrate(true);
    global.mockCurrentUser = { id: 7, a11yVibrate: false };
    render(<SettingsAccessibility />);
    expect(screen.getByText(/while Chatforia is visible/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Vibrate on new messages/i })).not.toBeDisabled();
  });

  test('Flash screen on incoming call disabled when prefers-reduced-motion is true', () => {
    setMatchMedia(true); // reduce motion
    global.mockCurrentUser = {};
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', {
      name: /Flash screen on incoming call/i,
    });
    expect(sw).toBeDisabled();
  });

  test('401 error displays "Please sign in again." for the specific field', async () => {
    global.mockCurrentUser = { a11yVibrate: false };
    render(<SettingsAccessibility />);

    const sw = screen.getByRole('switch', {
      name: /Vibrate on new messages/i,
    });
    axiosClient.patch.mockRejectedValueOnce({
      response: { status: 401 },
      message: 'unauth',
    });

    fireEvent.click(sw);

    await waitFor(() => {
      expect(
        screen.getByText(/Please sign in again\./i)
      ).toBeInTheDocument();
    });
  });
});


test('live caption title, switch and help text remain distinct with the real title translation present', () => {
  global.mockCurrentUser = { id: 65, a11yLiveCaptions: true };
  global.mockTranslations = { 'accessibilitySettings.liveCaptions': 'Live captions (calls)' };
  try {
    render(<SettingsAccessibility />);
    expect(screen.getAllByText('Live captions (calls)')).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Enable live captions' })).toBeChecked();
    expect(screen.getByText('Show captions of the other participant’s speech during calls. Requires Premium.')).toBeInTheDocument();
  } finally { delete global.mockTranslations; }
});
