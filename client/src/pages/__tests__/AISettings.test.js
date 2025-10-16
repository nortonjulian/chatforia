import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/* ---------- Mocks (keep everything in-factory or on global) ---------- */

// axios client — define jest.fn inside the factory, then import and use it
jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    patch: jest.fn(),
  },
}));
import axiosClient from '../../api/axiosClient';

// UserContext — expose mutable values on global so the factory can read them
global.__mockCurrentUser = null;
global.__setCurrentUserMock = jest.fn();
jest.mock('../../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: global.__mockCurrentUser,
    setCurrentUser: (...args) => global.__setCurrentUserMock(...args),
  }),
}));

// prefs store — define fns inside the factory; import named exports in tests
jest.mock('../../utils/prefsStore', () => ({
  __esModule: true,
  setPref: jest.fn(),
  PREF_SMART_REPLIES: 'PREF_SMART_REPLIES',
}));
import { setPref, PREF_SMART_REPLIES } from '../../utils/prefsStore';

// PremiumGuard — passthrough stub
jest.mock('../../components/PremiumGuard', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="premium-guard">{children}</div>,
}));

// Mantine core stubs (simple, prop-driven)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );

  const Button = ({ children, onClick, ...rest }) => (
    <button data-testid="button" onClick={onClick} {...rest}>{children}</button>
  );

  const Switch = ({ label, checked, onChange, disabled }) => (
    <label data-testid={`switch-${label}`} aria-disabled={disabled ? 'true' : 'false'}>
      <input
        type="checkbox"
        role="checkbox"
        aria-label={label}
        checked={!!checked}
        disabled={!!disabled}
        onChange={(e) => onChange?.(e)}
      />
      {label}
    </label>
  );

  const NumberInput = ({ label, value, onChange, disabled, min }) => (
    <label data-testid={`num-${label}`} aria-disabled={disabled ? 'true' : 'false'}>
      <input
        type="number"
        role="spinbutton"
        aria-label={label}
        value={value ?? ''}
        disabled={!!disabled}
        onChange={(e) => onChange?.(e.target.value === '' ? '' : Number(e.target.value))}
        min={min}
      />
    </label>
  );

  const Select = ({ label, value, onChange, data }) => (
    <div data-testid={`select-${label}`} data-value={value}>
      {(data || []).map((opt) => (
        <button
          key={opt.value}
          data-testid={`opt-${label}-${opt.value}`}
          onClick={() => onChange?.(opt.value)}
          disabled={!!opt.disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const TextInput = ({ label, value, onChange, disabled }) => (
    <label data-testid={`text-${label}`} aria-disabled={disabled ? 'true' : 'false'}>
      <input
        aria-label={label}
        value={value ?? ''}
        disabled={!!disabled}
        onChange={(e) => onChange?.(e)}
      />
    </label>
  );

  const Alert = ({ children, color }) => (
    <div data-testid={`alert-${color || 'info'}`}>{children}</div>
  );

  return {
    __esModule: true,
    Paper: passthru('paper'),
    Title: passthru('title'),
    Stack: passthru('stack'),
    Group: passthru('group'),
    Text: passthru('text'),
    Divider: passthru('divider'),
    Button,
    Switch,
    NumberInput,
    Select,
    TextInput,
    Alert,
  };
});

// Mantine DateTimePicker stub
jest.mock('@mantine/dates', () => ({
  __esModule: true,
  DateTimePicker: ({ label, value, onChange, disabled }) => (
    <div
      data-testid={`dtp-${label}`}
      data-disabled={String(!!disabled)}
      data-value={value ? new Date(value).toISOString() : ''}
    >
      {/* helper buttons to control the value in tests */}
      <button
        type="button"
        data-testid="set-datetime"
        onClick={() => onChange?.(new Date('2025-02-03T04:05:06Z'))}
        disabled={!!disabled}
      >
        set test date
      </button>
      <button
        type="button"
        data-testid="clear-datetime"
        onClick={() => onChange?.(null)}
        disabled={!!disabled}
      >
        clear
      </button>
    </div>
  ),
}));

/* ---------- SUT ---------- */

import AISettings from '../AISettings';

/* ---------- Test helpers ---------- */

function renderWithUser(user) {
  global.__mockCurrentUser = user;
  global.__setCurrentUserMock.mockReset();
  axiosClient.patch.mockReset();
  setPref.mockReset();
  return render(<AISettings />);
}

/* ---------- Tests ---------- */

describe('AISettings', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  test('initializes from currentUser and disables auto-responder controls when off', () => {
    renderWithUser({
      id: 9,
      enableSmartReplies: false,
      aiFilterProfanity: true,
      showOriginalWithTranslation: false,
      autoTranslateMode: 'TAGGED',
      enableAIResponder: false,
      autoResponderMode: 'off',
      autoResponderCooldownSec: 90,
      autoResponderSignature: '🤖 BRB',
      autoResponderActiveUntil: null,
    });

    // Translation select uses lowercased value
    expect(
      screen.getByTestId('select-Auto-translate incoming messages')
    ).toHaveAttribute('data-value', 'tagged');

    // Smart Replies + Mask profanity + show original
    expect(screen.getByRole('checkbox', { name: /Enable Smart Replies/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Mask profanity/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Show original text/i })).not.toBeChecked();

    // Auto-responder off; child controls disabled
    const responderSwitch = screen.getByRole('checkbox', { name: /Enable auto-reply/i });
    expect(responderSwitch).not.toBeChecked();
    expect(screen.getByTestId('select-Auto-reply mode')).toHaveAttribute('data-value', 'off');
    expect(screen.getByTestId('dtp-Active until (optional)')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByLabelText('Signature')).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /Cooldown/i })).toBeDisabled();
  });

  test('enabling auto-responder unlocks its controls', () => {
    renderWithUser({ id: 1 });

    fireEvent.click(screen.getByRole('checkbox', { name: /Enable auto-reply/i }));

    expect(screen.getByTestId('dtp-Active until (optional)')).toHaveAttribute('data-disabled', 'false');
    expect(screen.getByLabelText('Signature')).not.toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /Cooldown/i })).not.toBeDisabled();
  });

  test('successful save patches with transformed values, merges user, syncs PREF, and shows transient success', async () => {
    renderWithUser({
      id: 7,
      enableSmartReplies: false,
      aiFilterProfanity: false,
      showOriginalWithTranslation: true,
      autoTranslateMode: 'off',
      enableAIResponder: false,
      autoResponderMode: 'off',
      autoResponderCooldownSec: 120,
      autoResponderSignature: '🤖 Auto-reply',
      autoResponderActiveUntil: null,
    });

    // Set values:
    fireEvent.click(
      screen.getByTestId('opt-Auto-translate incoming messages-all')
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Show original text/i })); // -> false
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Smart Replies/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Mask profanity/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable auto-reply/i }));
    fireEvent.click(screen.getByTestId('opt-Auto-reply mode-dm'));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Cooldown/i }), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'BRB' } });
    fireEvent.click(screen.getByTestId('set-datetime'));

    axiosClient.patch.mockResolvedValueOnce({ data: { serverFlag: true } });

    fireEvent.click(screen.getByText(/Save AI Settings/i));

    await waitFor(() => {
      expect(axiosClient.patch).toHaveBeenCalledTimes(1);
    });

    const [url, body] = axiosClient.patch.mock.calls[0];
    expect(url).toBe('/users/7');
    expect(body).toEqual({
      enableSmartReplies: true,
      aiFilterProfanity: true,
      showOriginalWithTranslation: false,
      autoTranslateMode: 'ALL',
      enableAIResponder: true,
      autoResponderMode: 'dm',
      autoResponderCooldownSec: 45,
      autoResponderSignature: 'BRB',
      autoResponderActiveUntil: '2025-02-03T04:05:06.000Z',
    });

    // setCurrentUser merge
    expect(global.__setCurrentUserMock).toHaveBeenCalledTimes(1);
    const updater = global.__setCurrentUserMock.mock.calls[0][0];
    const merged = updater({ id: 7, prev: 1 });
    expect(merged).toEqual(
      expect.objectContaining({
        id: 7,
        prev: 1,
        serverFlag: true,
        autoTranslateMode: 'ALL',
        enableSmartReplies: true,
      })
    );

    // prefs sync
    expect(setPref).toHaveBeenCalledWith(PREF_SMART_REPLIES, true);

    // success alert appears and auto-clears
    expect(await screen.findByText(/AI preferences saved/i)).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(3000); });
    await waitFor(() => expect(screen.queryByText(/AI preferences saved/i)).toBeNull());
  });

  test('failed save shows error alert and clears after 3s', async () => {
    renderWithUser({ id: 33 });
    axiosClient.patch.mockRejectedValueOnce(new Error('boom'));

    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Smart Replies/i }));
    fireEvent.click(screen.getByText(/Save AI Settings/i));

    expect(await screen.findByText(/Failed to save AI settings/i)).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(3000); });
    await waitFor(() => expect(screen.queryByText(/Failed to save AI settings/i)).toBeNull());
  });

  test('clearing the active-until date sends null', async () => {
    renderWithUser({
      id: 99,
      enableAIResponder: true,
      autoResponderActiveUntil: '2025-02-03T04:05:06.000Z',
    });

    expect(screen.getByTestId('dtp-Active until (optional)')).toHaveAttribute(
      'data-value',
      '2025-02-03T04:05:06.000Z'
    );
    fireEvent.click(screen.getByTestId('clear-datetime'));

    axiosClient.patch.mockResolvedValueOnce({ data: {} });
    fireEvent.click(screen.getByText(/Save AI Settings/i));

    await waitFor(() => expect(axiosClient.patch).toHaveBeenCalled());
    const [, body] = axiosClient.patch.mock.calls[0];
    expect(body.autoResponderActiveUntil).toBeNull();
  });
});
