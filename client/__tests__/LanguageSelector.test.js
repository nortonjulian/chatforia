import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import LanguageSelector from '@/components/LanguageSelector';

// ---------- Mocks ----------

// Mock the API module that uses axiosClient (avoids import.meta issues)
const mockFetchLanguages = jest.fn();
jest.mock('@/api/languages', () => ({
  fetchLanguages: (...args) => mockFetchLanguages(...args),
}));

// Mantine Select → expose props + interactive <select>
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Select = (props) => {
    const {
      data = [],
      value,
      onChange,
      disabled,
      placeholder,
      label,
      nothingFoundMessage,
    } = props;

    return (
      <div>
        <div
          data-testid="mantine-select-props"
          data-disabled={disabled ? 'true' : 'false'}
          data-placeholder={placeholder}
          data-label={label}
          data-nothing={nothingFoundMessage}
        />
        <select
          aria-label="mantine-select"
          disabled={disabled}
          value={value || ''}
          onChange={(e) => onChange?.(e.target.value)}
        >
          {data.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  };
  return { __esModule: true, Select };
});

// i18next mock
const mockLoadLanguages = jest.fn(() => Promise.resolve());
const mockChangeLanguage = jest.fn(() => Promise.resolve());
const mockT = (k) => k;
let mockResolvedLanguage = 'en';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: {
      resolvedLanguage: mockResolvedLanguage,
      loadLanguages: mockLoadLanguages,
      changeLanguage: mockChangeLanguage,
    },
  }),
}));

// Helpers
const renderSelector = (props) => render(<LanguageSelector {...props} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockResolvedLanguage = 'en';

  // default languages returned by API
  mockFetchLanguages.mockResolvedValue([
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
  ]);
});

afterEach(() => {
  cleanup();
});

// ---------- Tests ----------
describe('LanguageSelector', () => {
  test('loads languages via API, disables while loading, then enables with options', async () => {
    renderSelector({ currentLanguage: 'en' });

    // Initially disabled while loading
    expect(screen.getByLabelText('mantine-select')).toBeDisabled();

    // Wait for API call
    await waitFor(() => expect(mockFetchLanguages).toHaveBeenCalledTimes(1));

    // Wait until the select becomes enabled
    await waitFor(() =>
      expect(screen.getByLabelText('mantine-select')).not.toBeDisabled()
    );

    const select = screen.getByLabelText('mantine-select');
    const opts = Array.from(select.querySelectorAll('option')).map((o) => ({
      value: o.value,
      label: o.textContent,
    }));
    const values = opts.map((o) => o.value);

    // Should contain the codes from the API
    expect(values).toEqual(expect.arrayContaining(['en', 'es', 'fr']));

    // Props exposure sanity
    const propsProbe = screen.getByTestId('mantine-select-props');
    expect(propsProbe.dataset.placeholder).toBe('profile.chooseLanguage');
    expect(propsProbe.dataset.label).toBe('profile.preferredLanguage');
    expect(propsProbe.dataset.nothing).toBe('common.noMatches');
  });

  test('selecting a new language triggers i18n load/change and onChange', async () => {
    const onChange = jest.fn();
    renderSelector({ currentLanguage: 'en', onChange });

    await waitFor(() => expect(mockFetchLanguages).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText('mantine-select')).not.toBeDisabled()
    );

    // Change to Spanish
    fireEvent.change(screen.getByLabelText('mantine-select'), {
      target: { value: 'es' },
    });

    // i18n effects are async
    await waitFor(() => {
      expect(mockLoadLanguages).toHaveBeenCalledWith('es');
    });
    expect(mockChangeLanguage).toHaveBeenCalledWith('es');
    expect(onChange).toHaveBeenCalledWith('es');
  });

  test('selecting the same language as resolvedLanguage does not call i18n methods', async () => {
    mockResolvedLanguage = 'en';
    const onChange = jest.fn();
    renderSelector({ currentLanguage: 'en', onChange });

    await waitFor(() => expect(mockFetchLanguages).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText('mantine-select')).not.toBeDisabled()
    );

    // Select same value "en"
    fireEvent.change(screen.getByLabelText('mantine-select'), {
      target: { value: 'en' },
    });

    // onChange still fires because the component always calls it
    expect(onChange).toHaveBeenCalledWith('en');

    // but i18n should *not* be asked to change
    expect(mockLoadLanguages).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  test('prop update: currentLanguage change syncs internal selected value', async () => {
    const { rerender } = renderSelector({ currentLanguage: 'en' });

    await waitFor(() => expect(mockFetchLanguages).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText('mantine-select')).not.toBeDisabled()
    );

    // Value should be 'en'
    expect(screen.getByLabelText('mantine-select').value).toBe('en');

    // Update prop -> should reflect
    rerender(<LanguageSelector currentLanguage="fr" />);
    expect(screen.getByLabelText('mantine-select').value).toBe('fr');
  });

  test('failed language fetch leaves selector disabled with no options', async () => {
    mockFetchLanguages.mockRejectedValueOnce(new Error('Network error'));

    renderSelector({ currentLanguage: 'en' });

    await waitFor(() => expect(mockFetchLanguages).toHaveBeenCalled());

    // Wait until loading=false (component finishes effect)
    await waitFor(() =>
      expect(screen.getByLabelText('mantine-select')).toBeDisabled()
    );

    const select = screen.getByLabelText('mantine-select');
    const values = Array.from(select.querySelectorAll('option')).map(
      (o) => o.value
    );
    expect(values).toEqual([]); // no options when API failed
  });
});
