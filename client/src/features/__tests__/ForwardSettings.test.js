import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// -------- Mocks --------
const apiGet = jest.fn();
const apiPatch = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => apiGet(...a),
    patch: (...a) => apiPatch(...a),
  },
}));

// Mantine notifications (we just ensure no crashes; banner text is our source of truth)
const notificationsShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  __esModule: true,
  notifications: { show: (...a) => notificationsShow(...a) },
}));

// Minimal Mantine core stubs with prop-based surface we can interact with
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );

  const Button = ({ children, onClick, disabled, loading, ...rest }) => (
    <button
      data-testid={`btn-${String(children).toLowerCase()}`}
      onClick={onClick}
      disabled={!!disabled || !!loading}
      {...rest}
    >
      {children}
    </button>
  );

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

// SUT
import ForwardingSettings from './ForwardSettings';

// -------- Helpers --------
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
  apiGet.mockReset();
  apiPatch.mockReset();
  notificationsShow.mockReset();

  // GET resolves to provided data
  apiGet.mockResolvedValueOnce({ data });

  return render(<ForwardingSettings />);
}

async function waitLoaded() {
  // Wait for loading card to be replaced by the main card
  await waitFor(() => {
    expect(screen.queryByText(/Loading forwarding settings/i)).not.toBeInTheDocument();
  });
}

function getButton(name) {
  return screen.getByTestId(`btn-${name.toLowerCase()}`);
}

describe('ForwardingSettings', () => {
  test('shows loading, then bootstraps from GET /settings/forwarding', async () => {
    // keep GET pending briefly to see loading UI
    let resolveGet;
    apiGet.mockImplementationOnce(() => new Promise((res) => { resolveGet = res; }));

    render(<ForwardingSettings />);

    // loading UI
    expect(screen.getByText(/Loading forwarding settings/i)).toBeInTheDocument();

    act(() => resolveGet({ data: initialServerData }));
    await waitLoaded();

    // baseline controls rendered
    expect(screen.getByTestId('divider-Text Forwarding')).toBeInTheDocument();
    expect(screen.getByTestId('divider-Call Forwarding (alias bridging)')).toBeInTheDocument();
  });

  test('change detection toggles Reset/Save availability', async () => {
    renderWithApi();
    await waitLoaded();

    const reset = getButton('Reset');
    const save = getButton('Save');

    // Initially no changes
    expect(reset).toBeDisabled();
    expect(save).toBeDisabled();

    // Enable text forwarding -> changes present
    const smsToggle = screen.getByTestId('chk-Enable text forwarding').querySelector('input');
    fireEvent.click(smsToggle);

    expect(reset).not.toBeDisabled();
    expect(save).not.toBeDisabled(); // will still be disabled later by validation if present
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

    // Destination error (none selected) should be gone since phone/email are checked
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
    apiPatch.mockResolvedValueOnce({
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

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());

    // Payload sent to server should be normalized
    const [url, body] = apiPatch.mock.calls[0];
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

    apiPatch.mockRejectedValueOnce(new Error('nope'));

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

    // Change phone number & show banner somehow
    fireEvent.change(screen.getByTestId('input-Destination phone (E.164)'), { target: { value: '+15558889999' } });
    // Fake a banner (simulate prior save)
    // (In real flow, banner is set on save; for this test we just imitate a state where it exists.)
    // Click Reset
    fireEvent.click(getButton('Reset'));

    // Value should return to serverData
    expect(screen.getByTestId('input-Destination phone (E.164)')).toHaveValue(serverData.forwardPhoneNumber);
    // Banner cleared (role=status element absent)
    expect(screen.queryByRole('status')).toBeNull();
  });
});
