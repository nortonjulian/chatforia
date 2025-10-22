import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import LanguageSelector from '@/components/LanguageSelector';

// ---------- Mocks ----------

// Mantine Select → expose props + interactive <select>
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Select = (props) => {
    const { data = [], value, onChange, disabled, placeholder, label, 'nothingFoundMessage': nothing } = props;
    return (
      <div>
        <div
          data-testid="mantine-select-props"
          data-disabled={disabled ? 'true' : 'false'}
          data-placeholder={placeholder}
          data-label={label}
          data-nothing={nothing}
        />
        <select
          aria-label="mantine-select"
          disabled={disabled}
          value={value || ''}
          onChange={(e) => onChange?.(e.target.value)}
        >
          {data.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  };
  return { Select };
});

// i18next (names prefixed with "mock" so Jest allows capture)
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

// fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Intl.DisplayNames (controlled)
class MockDisplayNames {
  of(code) {
    const base = (code || '').split('-')[0];
    const map = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', zh: undefined };
    return map[code] ?? map[base];
  }
}
global.Intl = { ...(global.Intl || {}), DisplayNames: MockDisplayNames };

// Helpers
const renderSelector = (props) => render(<LanguageSelector {...props} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockResolvedLanguage = 'en';
  // default manifest
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ codes: ['es', 'fr', 'zh-CN'] }),
  });
});

afterEach(() => {
  cleanup();
});

// ---------- Tests ----------
describe('LanguageSelector', () => {
  test('loads codes, disables while loading, then enables with options (includes current locale)', async () => {
    renderSelector({ currentLanguage: 'en' });

    // Initially disabled while loading
    expect(screen.getByLabelText('mantine-select')).toBeDisabled();

    // Wait for fetch to be requested
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(expect.stringMatching(/\/locales\/manifest\.json/))
    );

    // Wait until the select becomes enabled (loading=false and options computed)
    await waitFor(() => expect(screen.getByLabelText('mantine-select')).not.toBeDisabled());

    // Enabled and contains options, including current (en) even if not in manifest
    const select = screen.getByLabelText('mantine-select');
    const opts = Array.from(select.querySelectorAll('option')).map((o) => ({
      value: o.value,
      label: o.textContent,
    }));
    const values = opts.map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['en', 'es', 'fr', 'zh-CN']));

    // Special label applied for zh-CN
    const zh = opts.find((o) => o.value === 'zh-CN');
    expect(zh.label).toBe('Chinese (Simplified)');

    // Props exposure sanity
    const propsProbe = screen.getByTestId('mantine-select-props');
    expect(propsProbe.dataset.placeholder).toBe('profile.chooseLanguage');
    expect(propsProbe.dataset.label).toBe('profile.preferredLanguage');
    expect(propsProbe.dataset.nothing).toBe('common.noMatches');
  });

  test('selecting a new language triggers loadLanguages -> changeLanguage -> onChange', async () => {
    const onChange = jest.fn();
    renderSelector({ currentLanguage: 'en', onChange });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('mantine-select')).not.toBeDisabled());

    // Change to Spanish
    fireEvent.change(screen.getByLabelText('mantine-select'), { target: { value: 'es' } });

    await waitFor(() => {
      expect(mockLoadLanguages).toHaveBeenCalledWith('es');
    });
    expect(mockChangeLanguage).toHaveBeenCalledWith('es');
    expect(onChange).toHaveBeenCalledWith('es');
  });

  test('selecting the same language as resolvedLanguage does nothing', async () => {
    mockResolvedLanguage = 'en';
    const onChange = jest.fn();
    renderSelector({ currentLanguage: 'en', onChange });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('mantine-select')).not.toBeDisabled());

    // Select same value "en"
    fireEvent.change(screen.getByLabelText('mantine-select'), { target: { value: 'en' } });

    expect(mockLoadLanguages).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('prop update: currentLanguage change syncs internal selected value', async () => {
    const { rerender } = renderSelector({ currentLanguage: 'en' });
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('mantine-select')).not.toBeDisabled());

    // Value should be 'en'
    expect(screen.getByLabelText('mantine-select').value).toBe('en');

    // Update prop -> should reflect
    rerender(<LanguageSelector currentLanguage="fr" />);
    expect(screen.getByLabelText('mantine-select').value).toBe('fr');
  });

  test('failed manifest fetch results in options with just current locale (still enabled after load)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Not Found' });
    renderSelector({ currentLanguage: 'en' });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    // Wait until enabled after error path finishes (loading=false, options from resolvedLanguage)
    await waitFor(() => expect(screen.getByLabelText('mantine-select')).not.toBeDisabled());

    const select = screen.getByLabelText('mantine-select');
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);

    // Only "en" guaranteed (since we include i18n.resolvedLanguage)
    expect(values).toEqual(expect.arrayContaining(['en']));
  });

  test('options are alphabetically sorted by label (case-insensitive)', async () => {
    // Force manifest codes that will sort clearly with our mock names
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ codes: ['fr', 'es'] }), // English comes from resolvedLanguage
    });

    renderSelector({ currentLanguage: 'en' });
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('mantine-select')).not.toBeDisabled());

    const labels = Array.from(
      screen.getByLabelText('mantine-select').querySelectorAll('option')
    ).map((o) => o.textContent);

    // English, French, Spanish -> alphabetic => English, French, Spanish
    expect(labels).toEqual(['English', 'French', 'Spanish']);
  });
});
