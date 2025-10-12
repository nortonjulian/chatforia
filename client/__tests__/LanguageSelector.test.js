import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import LanguageSelector from '@/components/LanguageSelector';

// ---------- Mocks ----------

// Mantine Select → expose props + interactive <select>
let lastSelectProps;
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Select = (props) => {
    lastSelectProps = props;
    const { data = [], value, onChange, disabled, placeholder, label, 'nothingFoundMessage': nothing } = props;
    return (
      <div>
        <div data-testid="mantine-select-props"
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

// i18next
const loadLanguages = jest.fn(() => Promise.resolve());
const changeLanguage = jest.fn(() => Promise.resolve());
const t = (k) => k;
let resolvedLanguage = 'en';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t,
    i18n: {
      resolvedLanguage,
      loadLanguages,
      changeLanguage,
    },
  }),
}));

// fetch
const fetchMock = jest.fn();
global.fetch = fetchMock;

// Intl.DisplayNames (controlled)
class MockDisplayNames {
  of(code) {
    // Provide simple names for common bases; return undefined for zh-CN to force "special" map
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
  resolvedLanguage = 'en';
  // default manifest
  fetchMock.mockResolvedValue({
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

    // Loading: disabled
    expect(screen.getByLabelText('mantine-select')).toBeDisabled();

    // After fetch resolves
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/locales\/manifest\.json/));
    });

    // Enabled and contains options, including current (en) even if not in manifest
    const select = screen.getByLabelText('mantine-select');
    expect(select).not.toBeDisabled();

    const opts = Array.from(select.querySelectorAll('option')).map((o) => ({ value: o.value, label: o.textContent }));
    const values = opts.map(o => o.value);
    expect(values).toEqual(expect.arrayContaining(['en', 'es', 'fr', 'zh-CN']));

    // Special label applied for zh-CN
    const zh = opts.find(o => o.value === 'zh-CN');
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Change to Spanish
    fireEvent.change(screen.getByLabelText('mantine-select'), { target: { value: 'es' } });

    await waitFor(() => {
      expect(loadLanguages).toHaveBeenCalledWith('es');
    });
    expect(changeLanguage).toHaveBeenCalledWith('es');
    expect(onChange).toHaveBeenCalledWith('es');
  });

  test('selecting the same language as resolvedLanguage does nothing', async () => {
    resolvedLanguage = 'en';
    const onChange = jest.fn();
    renderSelector({ currentLanguage: 'en', onChange });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Select same value "en"
    fireEvent.change(screen.getByLabelText('mantine-select'), { target: { value: 'en' } });

    // Effect guard should prevent calls
    expect(loadLanguages).not.toHaveBeenCalled();
    expect(changeLanguage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('prop update: currentLanguage change syncs internal selected value', async () => {
    const { rerender } = renderSelector({ currentLanguage: 'en' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Value should be 'en'
    expect(screen.getByLabelText('mantine-select').value).toBe('en');

    // Update prop -> should reflect
    rerender(<LanguageSelector currentLanguage="fr" />);
    expect(screen.getByLabelText('mantine-select').value).toBe('fr');
  });

  test('failed manifest fetch results in options with just current locale (still enabled after load)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, statusText: 'Not Found' });
    renderSelector({ currentLanguage: 'en' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const select = screen.getByLabelText('mantine-select');
    expect(select).not.toBeDisabled();

    const values = Array.from(select.querySelectorAll('option')).map(o => o.value);
    // Only "en" guaranteed (since we include i18n.resolvedLanguage)
    expect(values).toEqual(expect.arrayContaining(['en']));
  });

  test('options are alphabetically sorted by label (case-insensitive)', async () => {
    // Force manifest codes that will sort clearly with our mock names
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ codes: ['fr', 'es'] }), // English comes from resolvedLanguage
    });

    renderSelector({ currentLanguage: 'en' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const labels = Array.from(screen.getByLabelText('mantine-select').querySelectorAll('option')).map(o => o.textContent);
    // English, French, Spanish -> alphabetic => English, French, Spanish
    expect(labels).toEqual(['English', 'French', 'Spanish']);
  });
});
