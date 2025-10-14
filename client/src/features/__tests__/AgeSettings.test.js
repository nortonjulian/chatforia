import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* ===========================
   Mocks
   =========================== */

// axiosClient.patch — use a variable that starts with "mock" so Jest allows closure.
const mockPatch = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { patch: (...args) => mockPatch(...args) },
}));

// User context
const mockUseUser = jest.fn();
const setCurrentUserMock = jest.fn();
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => mockUseUser(),
}));

// Minimal Mantine stubs (prop-driven, easy to interact with)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );

  const Select = ({ label, data, value, onChange, placeholder, ...rest }) => (
    <div data-testid="select-age" data-label={label} data-value={value || ''} data-placeholder={placeholder} {...rest}>
      {data?.map((opt) => (
        <button
          key={opt.value}
          data-testid={`age-opt-${opt.value}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const MultiSelect = ({ label, data, value = [], onChange, disabled, ...rest }) => (
    <div data-testid="multiselect" data-label={label} data-disabled={String(!!disabled)} {...rest}>
      <div data-testid="multiselect-values">{JSON.stringify(value)}</div>
      {data?.map((opt) => (
        <button
          key={opt.value}
          data-testid={`ms-opt-${opt.value}`}
          onClick={() => {
            const exists = value.includes(opt.value);
            const next = exists ? value.filter(v => v !== opt.value) : [...value, opt.value];
            onChange(next);
          }}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const Switch = ({ label, checked, onChange, disabled, ...rest }) => (
    <label data-testid="switch" data-label={label} data-disabled={String(!!disabled)} {...rest}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e)}
        disabled={disabled}
      />
      {label}
    </label>
  );

  const Button = ({ children, onClick, ...rest }) => (
    <button data-testid="button" onClick={onClick} {...rest}>{children}</button>
  );

  const Alert = ({ children, ...rest }) => <div data-testid="alert" {...rest}>{children}</div>;

  return {
    __esModule: true,
    Card: passthru('card'),
    Stack: passthru('stack'),
    Group: passthru('group'),
    Text: passthru('text'),
    Button,
    Select,
    MultiSelect,
    Switch,
    Alert,
  };
});

/* ===========================
   SUT
   =========================== */

import AgeSettings from '../settings/AgeSettings.jsx';

/* ===========================
   Helpers
   =========================== */

function renderWithUser(user) {
  mockUseUser.mockReturnValue({
    currentUser: user,
    setCurrentUser: setCurrentUserMock,
  });
  setCurrentUserMock.mockReset();
  return render(<AgeSettings />);
}

beforeEach(() => {
  mockPatch.mockReset();
  mockUseUser.mockReset?.();
  setCurrentUserMock.mockReset();
});

/* ===========================
   Tests
   =========================== */

describe('AgeSettings', () => {
  test('initializes from currentUser (adult) and hides teen alert', () => {
    renderWithUser({
      id: 1,
      ageBand: 'ADULT_25_34',
      wantsAgeFilter: true,
      randomChatAllowedBands: ['ADULT_18_24', 'ADULT_25_34'],
    });

    // Age select reflects current band
    expect(screen.getByTestId('select-age')).toHaveAttribute('data-value', 'ADULT_25_34');

    // Switch on, not disabled (adult)
    const sw = screen.getByTestId('switch');
    expect(sw.querySelector('input').checked).toBe(true);
    expect(sw).toHaveAttribute('data-disabled', 'false');

    // MultiSelect enabled for adults
    expect(screen.getByTestId('multiselect')).toHaveAttribute('data-disabled', 'false');
    // Teen alert hidden
    expect(screen.queryByTestId('alert')).toBeNull();
  });

  test('teen rules: locks to teen only, forces filter on, disables switch/multiselect, shows alert', () => {
    renderWithUser({
      id: 2,
      ageBand: 'TEEN_13_17',
      wantsAgeFilter: false, // even if false, UI should force true
      randomChatAllowedBands: ['ADULT_18_24'], // should be overridden to teen only
    });

    // Age select value teen
    expect(screen.getByTestId('select-age')).toHaveAttribute('data-value', 'TEEN_13_17');

    // Alert shown
    expect(screen.getByTestId('alert')).toHaveTextContent(/teens can only match with teens/i);

    // Switch forced on and disabled
    const sw = screen.getByTestId('switch');
    expect(sw.querySelector('input').checked).toBe(true);
    expect(sw).toHaveAttribute('data-disabled', 'true');

    // MultiSelect disabled and values coerced to teen only
    const ms = screen.getByTestId('multiselect');
    expect(ms).toHaveAttribute('data-disabled', 'true');
    const values = JSON.parse(screen.getByTestId('multiselect-values').textContent || '[]');
    expect(values).toEqual(['TEEN_13_17']);
  });

  test('changing from teen to adult strips teen from allowed options', () => {
    // Start as teen, then switch to adult
    renderWithUser({
      id: 3,
      ageBand: 'TEEN_13_17',
      wantsAgeFilter: true,
      randomChatAllowedBands: ['TEEN_13_17'],
    });

    // Change age to 25–34
    fireEvent.click(screen.getByTestId('age-opt-ADULT_25_34'));

    // Switch now should be enabled (adult)
    expect(screen.getByTestId('switch')).toHaveAttribute('data-disabled', 'false');

    // MultiSelect enabled
    expect(screen.getByTestId('multiselect')).toHaveAttribute('data-disabled', 'false');

    // Teen should be stripped from allowed
    const values = JSON.parse(screen.getByTestId('multiselect-values').textContent || '[]');
    expect(values).toEqual([]); // teen removed
  });

  test('toggling wantsAgeFilter enables/disables MultiSelect for adults', () => {
    renderWithUser({
      id: 4,
      ageBand: 'ADULT_18_24',
      wantsAgeFilter: false,
      randomChatAllowedBands: [],
    });

    // Initially disabled because wantsAgeFilter=false
    expect(screen.getByTestId('multiselect')).toHaveAttribute('data-disabled', 'true');

    // Toggle switch on
    const input = screen.getByTestId('switch').querySelector('input');
    fireEvent.click(input);
    expect(screen.getByTestId('multiselect')).toHaveAttribute('data-disabled', 'false');

    // Select an adult band
    fireEvent.click(screen.getByTestId('ms-opt-ADULT_25_34'));
    const values = JSON.parse(screen.getByTestId('multiselect-values').textContent || '[]');
    expect(values).toEqual(['ADULT_25_34']);
  });

  test('save sends PATCH and merges into setCurrentUser', async () => {
    const currentUser = {
      id: 5,
      ageBand: 'ADULT_35_49',
      wantsAgeFilter: true,
      randomChatAllowedBands: ['ADULT_35_49'],
      name: 'Riley',
    };

    renderWithUser(currentUser);

    // Set the mock response for PATCH (do this after any global resets)
    mockPatch.mockResolvedValueOnce({ data: { plan: 'pro' } });

    // Change age to 50+
    fireEvent.click(screen.getByTestId('age-opt-ADULT_50_PLUS'));
    // Ensure multiselect enabled (wantsAgeFilter=true)
    expect(screen.getByTestId('multiselect')).toHaveAttribute('data-disabled', 'false');

    // Toggle an allowed band (add 25–34)
    fireEvent.click(screen.getByTestId('ms-opt-ADULT_25_34'));

    // Save
    fireEvent.click(screen.getByText(/^Save$/));

    await waitFor(() => expect(mockPatch).toHaveBeenCalled());

    // Payload correctness
    const [url, body] = mockPatch.mock.calls[0];
    expect(url).toBe('/users/me');
    expect(body).toEqual({
      ageBand: 'ADULT_50_PLUS',
      wantsAgeFilter: true,
      randomChatAllowedBands: expect.arrayContaining(['ADULT_35_49', 'ADULT_25_34']),
    });

    // setCurrentUser called with merged data
    expect(setCurrentUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ...currentUser,
        plan: 'pro',
        ageBand: 'ADULT_50_PLUS',
        wantsAgeFilter: true,
        randomChatAllowedBands: expect.arrayContaining(['ADULT_35_49', 'ADULT_25_34']),
      })
    );
  });
});
