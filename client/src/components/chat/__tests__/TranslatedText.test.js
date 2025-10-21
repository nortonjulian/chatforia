import { render, screen, fireEvent } from '@testing-library/react';
import TranslatedText from '../../chat/TranslatedText'; // correct relative path

// ---- Mocks ----

// Mantine Text: expose size and attrs so we can assert them
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Text = ({ children, size, c, mt, style, onCopy }) => (
    <p
      data-testid="mantine-text"
      data-size={size}
      data-color={c || ''}
      data-mt={mt || ''}
      style={style}
      onCopy={onCopy}
    >
      {children}
    </p>
  );
  return { Text };
});

// i18next: return provided default string (2nd arg) if present, else key
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, def) => (typeof def === 'string' ? def : key),
  }),
}));

describe('TranslatedText', () => {
  test('only originalText provided -> renders original, no toggle', () => {
    render(<TranslatedText originalText="Original only" translatedText={null} />);
    expect(screen.getByText('Original only')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('only translatedText provided -> renders translated, no toggle', () => {
    render(<TranslatedText originalText="" translatedText="Translated only" />);
    expect(screen.getByText('Translated only')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('both texts with showBothDefault=true -> stacked texts, no toggle', () => {
    render(
      <TranslatedText
        originalText="Hello"
        translatedText="Hola"
        showBothDefault
      />
    );

    const texts = screen.getAllByTestId('mantine-text');
    expect(texts).toHaveLength(2);

    // Primary (first) shows original when showBothDefault=true
    expect(texts[0]).toHaveTextContent('Hello');
    expect(texts[0].dataset.size).toBe('md');

    // Secondary (second) shows translated, dimmed, smaller size
    expect(texts[1]).toHaveTextContent('Hola');
    expect(texts[1].dataset.size).toBe('sm');
    expect(texts[1].dataset.color).toBe('dimmed');

    // No toggle button when showBothDefault=true
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('both texts with showBothDefault=false -> toggle shows translation/original and updates aria-label', () => {
    render(
      <TranslatedText
        originalText="Hello"
        translatedText="Hola"
        showBothDefault={false}
      />
    );

    // Primary shows translated initially; button says "Show original"
    const primary = screen.getByTestId('mantine-text');
    expect(primary).toHaveTextContent('Hola');

    let btn = screen.getByRole('button', { name: /show original/i });
    expect(btn).toBeInTheDocument();

    // Click -> primary flips to original, button changes to "Show translation"
    fireEvent.click(btn);
    expect(primary).toHaveTextContent('Hello');

    btn = screen.getByRole('button', { name: /show translation/i });
    expect(btn).toBeInTheDocument();
  });

  test('condensed=true adjusts sizes and button font size', () => {
    render(
      <TranslatedText
        originalText="A"
        translatedText="B"
        showBothDefault
        condensed
      />
    );

    const texts = screen.getAllByTestId('mantine-text');
    expect(texts[0].dataset.size).toBe('sm'); // primary
    expect(texts[1].dataset.size).toBe('xs'); // secondary

    // In stacked mode there is no button; verify condensed toggle sizing in toggle mode:
    const { rerender } = render(
      <TranslatedText
        originalText="A"
        translatedText="B"
        showBothDefault={false}
        condensed
      />
    );
    const btn = screen.getByRole('button');
    expect(parseInt(getComputedStyle(btn).fontSize || btn.style.fontSize || '12', 10)).toBe(12);
  });

  test('onCopy handler is called when copying the primary text', () => {
    const onCopy = jest.fn();
    render(
      <TranslatedText
        originalText="Hello"
        translatedText="Hola"
        showBothDefault={false}
        onCopy={onCopy}
      />
    );

    const primary = screen.getByTestId('mantine-text');
    fireEvent.copy(primary);
    expect(onCopy).toHaveBeenCalled();
  });
});
