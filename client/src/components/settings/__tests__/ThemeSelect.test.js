import { render, screen, fireEvent } from '@testing-library/react';
import ThemeSelect from '../ThemeSelect.jsx'; // ✅ relative import

// ---------- Mocks ----------
const mockGetTheme = jest.fn();
const mockSetTheme = jest.fn();

jest.mock('../../../utils/themeManager', () => ({
  getTheme: (...args) => mockGetTheme(...args),
  setTheme: (...args) => mockSetTheme(...args),
}));

jest.mock('../../../config/themes', () => ({
  THEME_CATALOG: {
    free: ['dawn', 'midnight'],
    premium: ['amoled'],
  },
  THEME_LABELS: {
    dawn: 'Dawn',
    midnight: 'Midnight',
    amoled: 'AMOLED',
  },
}));

// Mantine: render a real <select> that accepts grouped data
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Select = ({ label, value, data, onChange, id, withinPortal }) => {
    // data can be an array of groups: [{ group, items: [{value,label,disabled}] }]
    const isGrouped = Array.isArray(data) && data.length && data[0].group;
    return (
      <label htmlFor={id || 'select-theme'}>
        {label}
        <select
          id={id || 'select-theme'}
          aria-label={label}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          data-testid="mantine-select"
        >
          {isGrouped
            ? data.map((g) => (
                <optgroup key={g.group} label={g.group} data-testid={`group-${g.group}`}>
                  {g.items.map((opt) => (
                    <option
                      key={opt.value}
                      value={opt.value}
                      disabled={!!opt.disabled}
                      data-testid={`opt-${opt.value}`}
                    >
                      {opt.label || opt.value}
                    </option>
                  ))}
                </optgroup>
              ))
            : data.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={!!opt.disabled}
                  data-testid={`opt-${opt.value}`}
                >
                  {opt.label || opt.value}
                </option>
              ))}
        </select>
      </label>
    );
  };

  const Stack = ({ children }) => <div data-testid="stack">{children}</div>;
  const Switch = (props) => <input type="checkbox" {...props} />;

  return { Select, Stack, Switch };
});

beforeEach(() => {
  jest.clearAllMocks();

  // default starting theme
  mockGetTheme.mockReturnValue('dawn');

  // make the mock behave like the real setTheme for the bits we assert:
  // - if theme === 'midnight' and localStorage 'co-cta' === 'cool' → set data-cta="cool"
  // - otherwise → clear attribute and remove the storage key
  mockSetTheme.mockImplementation((theme) => {
    const override = localStorage.getItem('co-cta');
    if (theme === 'midnight' && override === 'cool') {
      document.documentElement.setAttribute('data-cta', 'cool');
    } else {
      document.documentElement.removeAttribute('data-cta');
      localStorage.removeItem('co-cta');
    }
  });

  // clean slate
  document.documentElement.removeAttribute('data-cta');
  localStorage.removeItem('co-cta');
});

// ---------- Tests ----------
describe('ThemeSelect', () => {
  test('calls setTheme(getTheme()) once on mount', () => {
    mockGetTheme.mockReturnValue('dawn');
    render(<ThemeSelect isPremium={false} />);

    // on mount effect should call setTheme with initial value once
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith('dawn');

    // select reflects initial value
    const sel = screen.getByTestId('mantine-select');
    expect(sel).toHaveValue('dawn');
  });

  test('free themes selectable by anyone; premium disabled when not premium', () => {
    render(<ThemeSelect isPremium={false} />);

    // premium option is present but disabled
    const optAmoled = screen.getByTestId('opt-amoled');
    expect(optAmoled).toBeDisabled();

    // selecting free theme triggers setTheme and updates value
    const sel = screen.getByTestId('mantine-select');
    expect(sel).toHaveValue('dawn');

    fireEvent.change(sel, { target: { value: 'midnight' } });
    expect(mockSetTheme).toHaveBeenCalledWith('midnight');
    expect(sel).toHaveValue('midnight');

    // attempting to change to premium should be ignored by component logic
    mockSetTheme.mockClear();
    fireEvent.change(sel, { target: { value: 'amoled' } });
    // no additional calls (blocked)
    expect(mockSetTheme).not.toHaveBeenCalled();
    // value remains previous (midnight)
    expect(sel).toHaveValue('midnight');
  });

  test('premium themes selectable when isPremium=true', () => {
    render(<ThemeSelect isPremium />);

    // premium option should be enabled for premium users (component guards selection)
    const sel = screen.getByTestId('mantine-select');
    fireEvent.change(sel, { target: { value: 'amoled' } });

    expect(mockSetTheme).toHaveBeenCalledWith('amoled');
    expect(sel).toHaveValue('amoled');
  });

  test('grouped options render (Free & Premium) and hideFreeOptions removes Free group', () => {
    const { rerender } = render(<ThemeSelect isPremium={false} />);

    // Both groups visible
    expect(screen.getByTestId('group-Free')).toBeInTheDocument();
    expect(screen.getByTestId('group-Premium')).toBeInTheDocument();

    // Hide free group
    rerender(<ThemeSelect isPremium={false} hideFreeOptions />);
    expect(screen.queryByTestId('group-Free')).not.toBeInTheDocument();
    expect(screen.getByTestId('group-Premium')).toBeInTheDocument();
  });

  test('midnight + localStorage co-cta=cool sets data-cta, switching away clears it', () => {
    // Start with midnight and cool override on
    mockGetTheme.mockReturnValue('midnight');
    localStorage.setItem('co-cta', 'cool');

    render(<ThemeSelect isPremium={false} />);

    // Effect should set attribute when midnight && coolOnMidnight
    expect(document.documentElement.getAttribute('data-cta')).toBe('cool');
    expect(localStorage.getItem('co-cta')).toBe('cool');

    // Switch to a non-midnight theme -> attribute and storage cleared
    const sel = screen.getByTestId('mantine-select');
    fireEvent.change(sel, { target: { value: 'dawn' } });

    expect(document.documentElement.getAttribute('data-cta')).toBeNull();
    expect(localStorage.getItem('co-cta')).toBeNull();
  });
});
