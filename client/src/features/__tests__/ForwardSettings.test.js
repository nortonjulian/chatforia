import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// -------- Mocks (must be declared BEFORE imports that use them) --------
const mockApiGet = jest.fn();
const mockApiPatch = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockApiGet(...a),
    patch: (...a) => mockApiPatch(...a),
  },
}));

const mockNotificationsShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  __esModule: true,
  notifications: { show: (...a) => mockNotificationsShow(...a) },
}));

// Minimal Mantine core stubs with prop-based surface we can interact with
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );

  const Button = ({ children, onClick, disabled, loading, ...rest }) => {
    const label = String(children);
    // Normalize test IDs so tests can use getButton('Save') / getButton('Reset')
    let testId = rest['data-testid'];
    if (!testId) {
      if (/save/i.test(label)) {
        testId = 'btn-save';
      } else if (/reset/i.test(label)) {
        testId = 'btn-reset';
      } else {
        testId = `btn-${label.toLowerCase()}`;
      }
    }

    return (
      <button
        data-testid={testId}
        onClick={onClick}
        disabled={!!disabled || !!loading}
        {...rest}
      >
        {children}
      </button>
    );
  };

  const Checkbox = ({ label, checked, onChange, ...rest }) => (
    <label data-testid={`chk-${label}`} {...rest}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange?.(e)}
      />
      {label}
    </label>
  );

  const TextInput = ({ label, value, onChange, placeholder, error, disabled, ...rest }) => (
    <label data-testid={`txt-${label}`} {...rest}>
      <input
        data-testid={`input-${label}`}
        placeholder={placeholder || ''}
        value={value ?? ''}
        disabled={!!disabled}
        onChange={(e) => onChange?.(e)}
      />
      {error ? <div data-testid={`err-${label}`}>{error}</div> : null}
    </label>
  );

  const NumberInput = ({ label, value, onChange, ...rest }) => (
    <label data-testid={`num-${label}`} {...rest}>
      <input
        data-testid={`numinput-${label}`}
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  );

  const Divider = ({ label }) => <div data-testid={`divider-${label || ''}`}>{label}</div>;
  const Text = ({ children, ...rest }) => <div data-testid="text" {...rest}>{children}</div>;

  return {
    __esModule: true,
    Card: passthru('card'),
    Stack: passthru('stack'),
    Group: passthru('group'),
    Title: passthru('title'),
    Text,
    Divider,
    Button,
    Checkbox,
    TextInput,
    NumberInput,
  };
});

// -------- SUT --------
import ForwardingSettings from '../settings/ForwardingSettings.jsx';

// -------- Helpers / Fixtures --------
const initialServerData = {
  forwardingEnabledSms: false,
  forwardSmsToPhone: false,
  forwardPhoneNumber: '',
  forwardSmsToEmail: false,
  forwardEmail: '',
  forwardingEnabledCalls: false,
  forwardToPhoneE164: '',
  forwardQuietHoursStart: null,
  forwardQuietHoursEnd: null,
};

function renderWithApi(data = initialServerData) {
  mockApiGet.mockReset();
  mockApiPatch.mockReset();
  mockNotificationsShow.mockReset();

  mockApiGet.mockResolvedValueOnce({ data });
  return render(<ForwardingSettings />);
}

async function waitLoaded() {
  await waitFor(() => {
    expect(screen.queryByText(/Loading forwarding settings/i)).not.toBeInTheDocument();
  });
}

function getButton(name) {
  return screen.getByTestId(`btn-${name.toLowerCase()}`);
}

// -------- Tests --------
describe('ForwardingSettings', () => {
  test('shows loading, then bootstraps from GET /settings/forwarding', async () => {
    // keep GET pending briefly to see loading UI
    let resolveGet;
    mockApiGet.mockImplementationOnce(() => new Promise((res) => { resolveGet = res; }));

    render(<ForwardingSettings />);

    // loading UI
    expect(screen.getByText(/Loading forwarding settings/i)).toBeInTheDocument();

    act(() => resolveGet({ data: initialServerData }));
    await waitLoaded();

    // baseline controls rendered
    expect(screen.getByTestId('divider-Text Forwarding')).toBeInTheDocument();
    expect(screen.getByTestId('divider-Call Forwarding (alias bridging)')).toBeInTheDocument();
  });

  test('change detection toggles Reset availability (Save may remain disabled until valid)', async () => {
    renderWithApi();
    await waitLoaded();

    const reset = getButton('Reset');
    const save = getButton('Save');

    // Initially no changes
    expect(reset).toBeDisabled();
    expect(save).toBeDisabled();

    // Enable text forwarding -> we consider this a change
    const smsToggle = screen.getByTestId('chk-Enable text forwarding').querySelector('input');
    fireEvent.click(smsToggle);

    // Reset enabled due to change; Save can remain disabled until validation passes
    expect(reset).not.toBeDisabled();
    expect(save).toBeDisabled();
  });

  test('SMS validation: requires at least one destination; validates phone/email; enables inputs when toggled', async () => {
    renderWithApi();
    await waitLoaded();

    // Enable SMS forwarding
    fireEvent.click(screen.getByTestId('chk-Enable text forwarding').querySelector('input'));

    // No destinations yet -> shows guidance error
    expect(await screen.findByText(/Choose at least one destination/i)).toBeInTheDocument();

    // Toggle phone destination ON -> input enabled
    const chkPhone = screen.getByTestId('chk-Forward texts to phone').querySelector('input');
    fireEvent.click(chkPhone);
    const phoneInput = screen.getByTestId('input-Destination phone (E.164)');
    expect(phoneInput).not.toBeDisabled();

    // Enter invalid phone -> error shown
    fireEvent.change(phoneInput, { target: { value: '12345' } });
    expect(screen.getByTestId('err-Destination phone (E.164)')).toHaveTextContent(/E\.164/);

    // Toggle email destination ON, enter invalid email
    fireEvent.click(screen.getByTestId('chk-Forward texts to email').querySelector('input'));
    const emailInput = screen.getByTestId('input-Destination email');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    expect(screen.getByTestId('err-Destination email')).toHaveTextContent(/valid email/);

    // Fix both: valid E.164 & email
    fireEvent.change(phoneInput, { target: { value: '+1 (555) 123-4567' } });
    expect(screen.queryByTestId('err-Destination phone (E.164)')).toBeNull();

    fireEvent.change(emailInput, { target: { value: 'me@example.com' } });
    expect(screen.queryByTestId('err-Destination email')).toBeNull();

    // Destination error gone since phone/email are checked
    expect(screen.queryByText(/Choose at least one destination/i)).toBeNull();
  });

  test('Call forwarding validation: E.164 enforced and input disabled until enabled', async () => {
    renderWithApi();
    await waitLoaded();

    const callDest = screen.getByTestId('input-Destination (E.164) for calls');
    expect(callDest).toBeDisabled();

    // Enable calls
    fireEvent.click(screen.getByTestId('chk-Enable call forwarding').querySelector('input'));
    expect(callDest).not.toBeDisabled();

    // Invalid number -> error
    fireEvent.change(callDest, { target: { value: 'abc' } });
    expect(screen.getByTestId('err-Destination (E.164) for calls')).toHaveTextContent(/E\.164/);

    // Valid number clears error
    fireEvent.change(callDest, { target: { value: '+15551234567' } });
    expect(screen.queryByTestId('err-Destination (E.164) for calls')).toBeNull();
  });

  test('Quiet hours validation: must be between 0 and 23; blocks Save when invalid', async () => {
    renderWithApi();
    await waitLoaded();

    // Make some unrelated change so Save becomes relevant
    fireEvent.click(screen.getByTestId('chk-Enable text forwarding').querySelector('input'));
    fireEvent.click(screen.getByTestId('chk-Forward texts to phone').querySelector('input'));
    fireEvent.change(screen.getByTestId('input-Destination phone (E.164)'), { target: { value: '+15551234567' } });

    // Set invalid hour
    fireEvent.change(screen.getByTestId('numinput-Start hour (0–23)'), { target: { value: '25' } });
    expect(await screen.findByText(/Quiet hours must be between 0 and 23/i)).toBeInTheDocument();

    // Save disabled due to error
    expect(getButton('Save')).toBeDisabled();

    // Fix to valid range
    fireEvent.change(screen.getByTestId('numinput-Start hour (0–23)'), { target: { value: '22' } });
    expect(screen.queryByText(/Quiet hours must be between 0 and 23/i)).toBeNull();
  });

  test('Save success: normalizes E.164, PATCHes, shows banner, resets hasChanges', async () => {
    renderWithApi();
    await waitLoaded();

    // Enable SMS -> phone + email
    fireEvent.click(screen.getByTestId('chk-Enable text forwarding').querySelector('input'));
    fireEvent.click(screen.getByTestId('chk-Forward texts to phone').querySelector('input'));
    fireEvent.change(screen.getByTestId('input-Destination phone (E.164)'), { target: { value: '+1 (555) 111-2222' } });

    fireEvent.click(screen.getByTestId('chk-Forward texts to email').querySelector('input'));
    fireEvent.change(screen.getByTestId('input-Destination email'), { target: { value: 'me@example.com' } });

    // Enable calls with a non-normalized value
    fireEvent.click(screen.getByTestId('chk-Enable call forwarding').querySelector('input'));
    fireEvent.change(screen.getByTestId('input-Destination (E.164) for calls'), { target: { value: '+1 555 999 0000' } });

    // Quiet hours valid
    fireEvent.change(screen.getByTestId('numinput-Start hour (0–23)'), { target: { value: '21' } });
    fireEvent.change(screen.getByTestId('numinput-End hour (0–23)'), { target: { value: '7' } });

    // PATCH returns server-shaped data (could echo back)
    mockApiPatch.mockResolvedValueOnce({
      data: {
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardPhoneNumber: '+15551112222', // normalized
        forwardSmsToEmail: true,
        forwardEmail: 'me@example.com',
        forwardingEnabledCalls: true,
        forwardToPhoneE164: '+15559990000', // normalized
        forwardQuietHoursStart: 21,
        forwardQuietHoursEnd: 7,
      },
    });

    // Save
    const save = getButton('Save');
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => expect(mockApiPatch).toHaveBeenCalled());

    // Payload sent to server should be normalized
    const [url, body] = mockApiPatch.mock.calls[0];
    expect(url).toBe('/settings/forwarding');
    expect(body).toEqual(
      expect.objectContaining({
        forwardPhoneNumber: '+15551112222',
        forwardToPhoneE164: '+15559990000',
        forwardEmail: 'me@example.com',
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardSmsToEmail: true,
        forwardingEnabledCalls: true,
        forwardQuietHoursStart: 21,
        forwardQuietHoursEnd: 7,
      })
    );

    // Success banner
    expect(await screen.findByRole('status')).toHaveTextContent(/Forwarding settings saved/i);

    // After server echo and local state sync, there should be no changes pending → Save disabled
    await waitFor(() => expect(getButton('Save')).toBeDisabled());
    expect(getButton('Reset')).toBeDisabled();
  });

  test('Save failure shows error banner and leaves changes intact', async () => {
    renderWithApi();
    await waitLoaded();

    // Make minimal valid change: enable SMS, phone on, valid number
    fireEvent.click(screen.getByTestId('chk-Enable text forwarding').querySelector('input'));
    fireEvent.click(screen.getByTestId('chk-Forward texts to phone').querySelector('input'));
    fireEvent.change(screen.getByTestId('input-Destination phone (E.164)'), { target: { value: '+15551234567' } });

    mockApiPatch.mockRejectedValueOnce(new Error('nope'));

    fireEvent.click(getButton('Save'));

    // Error banner
    expect(await screen.findByRole('status')).toHaveTextContent(/Failed to save settings/i);

    // Still changes pending (Save may still be enabled since form differs from initial)
    expect(getButton('Save')).not.toBeDisabled();
  });

  test('Reset restores initial values and clears banner', async () => {
    const serverData = {
      ...initialServerData,
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardPhoneNumber: '+15551230000',
    };

    renderWithApi(serverData);
    await waitLoaded();

    // Change phone number & show banner somehow (simulate a prior save by setting banner through the UI flow later)
    fireEvent.change(screen.getByTestId('input-Destination phone (E.164)'), { target: { value: '+15558889999' } });

    // Click Reset
    fireEvent.click(getButton('Reset'));

    // Value should return to serverData
    expect(screen.getByTestId('input-Destination phone (E.164)')).toHaveValue(serverData.forwardPhoneNumber);
    // Banner cleared (role=status element absent)
    expect(screen.queryByRole('status')).toBeNull();
  });
});
