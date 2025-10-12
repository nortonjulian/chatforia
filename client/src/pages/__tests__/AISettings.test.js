import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---------- Mocks ----------
const patchMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { patch: (...a) => patchMock(...a) },
}));

const setCurrentUserMock = jest.fn();
let currentUserState;
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: currentUserState,
    setCurrentUser: setCurrentUserMock,
  }),
}));

const setPrefMock = jest.fn();
jest.mock('@/utils/prefsStore', () => ({
  __esModule: true,
  setPref: (...a) => setPrefMock(...a),
  PREF_SMART_REPLIES: 'PREF_SMART_REPLIES',
}));

jest.mock('@/components/PremiumGuard', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="premium-guard">{children}</div>,
}));

// Mantine core stubs (prop-driven & simple)
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
    <div data-testid={`dtp-${label}`} data-disabled={String(!!disabled)} data-value={value ? new Date(value).toISOString() : ''}>
      {/* Expose a helper button to set a known date */}
      <button
        type="button"
        data-testid="set-datetime"
        onClick={() => onChange?.(new Date('2025-02-03T04:05:06Z'))}
        disabled={!!disabled}
      >
        set test date
      </button>
      {/* Clear button */}
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

// SUT
import AISettings from './AISettings';

function renderWithUser(user) {
  currentUserState = user;
  setCurrentUserMock.mockReset();
  patchMock.mockReset();
  setPrefMock.mockReset();
  return render(<AISettings />);
}

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
    expect(screen.getByTestId('select-Auto-translate incoming messages')).toHaveAttribute('data-value', 'tagged');

    // Smart Replies + Mask profanity + show original
    expect(screen.getByRole('checkbox', { name: /Enable Smart Replies/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Mask profanity/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Show original text/i })).not.toBeChecked();

    // Auto-responder master switch off; child controls disabled
    const responderSwitch = screen.getByRole('checkbox', { name: /Enable auto-reply/i });
    expect(responderSwitch).not.toBeChecked();
    expect(screen.getByTestId('select-Auto-reply mode')).toHaveAttribute('data-value', 'off');
    expect(screen.getByTestId('dtp-Active until (optional)')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByLabelText('Signature')).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /Cooldown/i })).toBeDisabled();
  });

  test('enabling auto-responder unlocks its controls', () => {
    renderWithUser({ id: 1 });

    // enable
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable auto-reply/i }));
    // controls enabled
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
    // autoTranslateMode -> all
    fireEvent.click(screen.getByTestId('opt-Auto-translate incoming messages-Translate all incoming messages'));

    // showOriginalWithTranslation -> false
    fireEvent.click(screen.getByRole('checkbox', { name: /Show original text/i }));

    // enable Smart Replies & mask profanity
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Smart Replies/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Mask profanity/i }));

    // Enable responder and set fields
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable auto-reply/i }));
    // mode -> dm
    fireEvent.click(screen.getByTestId('opt-Auto-reply mode-1:1 chats only'));
    // cooldown -> 45
    fireEvent.change(screen.getByRole('spinbutton', { name: /Cooldown/i }), { target: { value: '45' } });
    // signature
    fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'BRB' } });
    // set until date via helper
    fireEvent.click(screen.getByTestId('set-datetime'));

    // Server echoes some extra field
    patchMock.mockResolvedValueOnce({ data: { serverFlag: true } });

    // Save
    fireEvent.click(screen.getByText(/Save AI Settings/i));

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledTimes(1);
    });

    // Payload verification
    const [url, body] = patchMock.mock.calls[0];
    expect(url).toBe('/users/7');
    expect(body).toEqual({
      enableSmartReplies: true,
      aiFilterProfanity: true,
      showOriginalWithTranslation: false,
      autoTranslateMode: 'ALL',            // uppercased
      enableAIResponder: true,
      autoResponderMode: 'dm',
      autoResponderCooldownSec: 45,        // number
      autoResponderSignature: 'BRB',
      autoResponderActiveUntil: '2025-02-03T04:05:06.000Z', // ISO string
    });

    // setCurrentUser merge
    expect(setCurrentUserMock).toHaveBeenCalledTimes(1);
    const updater = setCurrentUserMock.mock.calls[0][0];
    expect(typeof updater).toBe('function');
    const merged = updater({ id: 7, prev: 1 });
    expect(merged).toEqual(expect.objectContaining({
      id: 7,
      prev: 1,
      serverFlag: true,
      autoTranslateMode: 'ALL',
      enableSmartReplies: true,
    }));

    // prefs sync
    expect(setPrefMock).toHaveBeenCalledWith('PREF_SMART_REPLIES', true);

    // Success alert appears…
    expect(await screen.findByText(/AI preferences saved/i)).toBeInTheDocument();
    // …and auto-clears after 3s
    act(() => { jest.advanceTimersByTime(3000); });
    await waitFor(() => expect(screen.queryByText(/AI preferences saved/i)).toBeNull());
  });

  test('failed save shows error alert and clears after 3s', async () => {
    renderWithUser({ id: 33 });
    patchMock.mockRejectedValueOnce(new Error('boom'));

    // Make a trivial change so save does something
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Smart Replies/i }));
    fireEvent.click(screen.getByText(/Save AI Settings/i));

    // Error status
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

    // date picker initially has value; then clear it
    expect(screen.getByTestId('dtp-Active until (optional)')).toHaveAttribute(
      'data-value',
      '2025-02-03T04:05:06.000Z'
    );
    fireEvent.click(screen.getByTestId('clear-datetime'));

    patchMock.mockResolvedValueOnce({ data: {} });
    fireEvent.click(screen.getByText(/Save AI Settings/i));

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const [, body] = patchMock.mock.calls[0];
    expect(body.autoResponderActiveUntil).toBeNull();
  });
});
