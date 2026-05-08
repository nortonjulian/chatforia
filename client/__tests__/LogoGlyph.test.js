import { render, screen } from '@testing-library/react';
import LogoGlyph from '@/components/LogoGlyph';

const realRandom = Math.random;

function mockRandomSequence(seq) {
  let i = 0;
  Math.random = () => {
    const val = seq[i] ?? seq[seq.length - 1];
    i += 1;
    return val;
  };
}

afterEach(() => {
  Math.random = realRandom;
});

describe('LogoGlyph', () => {
  test('renders an accessible SVG with default sizing and viewBox', () => {
    mockRandomSequence([0.111111]);

    render(<LogoGlyph />);

    const svg = screen.getByRole('img', { name: /chatforia/i });

    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '64px');
    expect(svg).toHaveAttribute('height', '64px');
    expect(svg).toHaveAttribute('viewBox', '110 110 290 290');
  });

  test('accepts number sizes converted to px and string sizes unchanged', () => {
    mockRandomSequence([0.2]);

    const { rerender } = render(<LogoGlyph size={128} />);

    let svg = screen.getByRole('img', { name: /chatforia/i });
    expect(svg).toHaveAttribute('width', '128px');
    expect(svg).toHaveAttribute('height', '128px');

    rerender(<LogoGlyph size="80%" />);

    svg = screen.getByRole('img', { name: /chatforia/i });
    expect(svg).toHaveAttribute('width', '80%');
    expect(svg).toHaveAttribute('height', '80%');
  });

  test('defines a unique gradient id and uses it on the bubble path', () => {
    mockRandomSequence([0.3333]);

    const { container } = render(<LogoGlyph />);

    const gradient = container.querySelector('linearGradient[id^="cfGradient_"]');
    expect(gradient).toBeInTheDocument();

    const bubblePath = container.querySelector('path');
    expect(bubblePath).toHaveAttribute('fill', `url(#${gradient.id})`);
    expect(bubblePath).toHaveAttribute('stroke', 'var(--logo-outline, #8B5A2B)');
    expect(bubblePath).toHaveAttribute('stroke-width', '3.5');
  });

  test('generates different gradient ids for separate mounted instances', () => {
    mockRandomSequence([0.3333]);

    const { container: container1 } = render(<LogoGlyph />);
    const gradient1 = container1.querySelector('linearGradient[id^="cfGradient_"]');

    Math.random = realRandom;
    mockRandomSequence([0.7777]);

    const { container: container2 } = render(<LogoGlyph />);
    const gradient2 = container2.querySelector('linearGradient[id^="cfGradient_"]');

    expect(gradient1.id).not.toBe(gradient2.id);
  });

  test('draws the C path with expected fill and stroke attributes', () => {
    mockRandomSequence([0.4444]);

    const { container } = render(<LogoGlyph />);

    const paths = container.querySelectorAll('path');
    const cPath = paths[paths.length - 1];

    expect(cPath).toHaveAttribute('fill', 'var(--logo-c, #FFFFFF)');
    expect(cPath).toHaveAttribute('stroke', 'var(--logo-outline, #8B5A2B)');
    expect(cPath).toHaveAttribute('stroke-width', '2.4');
    expect(cPath).toHaveAttribute('stroke-linejoin', 'round');
  });

  test('compact variant uses currentColor bubble and white C', () => {
    mockRandomSequence([0.5555]);

    const { container } = render(<LogoGlyph variant="compact" />);

    const paths = container.querySelectorAll('path');
    const bubblePath = paths[0];
    const cPath = paths[1];

    expect(bubblePath).toHaveAttribute('fill', 'currentColor');
    expect(cPath).toHaveAttribute('fill', 'white');
  });
});