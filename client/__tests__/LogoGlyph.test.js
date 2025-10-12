import { render, screen } from '@testing-library/react';
import LogoGlyph from '@/components/LogoGlyph'; // <-- adjust path

// Helper to control Math.random so the generated IDs are predictable
const realRandom = Math.random;
function mockRandomSequence(seq) {
  let i = 0;
  Math.random = () => {
    const val = seq[i] ?? seq[seq.length - 1];
    i += 1;
    return val;
  };
}
function restoreRandom() {
  Math.random = realRandom;
}

afterEach(() => {
  restoreRandom();
});

describe('LogoGlyph', () => {
  test('renders an accessible SVG with default sizing and viewBox', () => {
    mockRandomSequence([0.111111]); // deterministic id suffix
    render(<LogoGlyph />);

    const svg = screen.getByRole('img', { name: /chatforia/i });
    expect(svg).toBeInTheDocument();
    // default size = 64 => width/height "64px"
    expect(svg.getAttribute('width')).toBe('64px');
    expect(svg.getAttribute('height')).toBe('64px');
    expect(svg.getAttribute('viewBox')).toBe('0 0 256 256');
  });

  test('accepts number (converted to px) and string sizes unchanged', () => {
    mockRandomSequence([0.2]);
    const { rerender } = render(<LogoGlyph size={128} />);
    let svg = screen.getByRole('img', { name: /chatforia/i });
    expect(svg.getAttribute('width')).toBe('128px');
    expect(svg.getAttribute('height')).toBe('128px');

    rerender(<LogoGlyph size="80%" />);
    svg = screen.getByRole('img', { name: /chatforia/i });
    expect(svg.getAttribute('width')).toBe('80%');
    expect(svg.getAttribute('height')).toBe('80%');
  });

  test('defines gradient/filter with unique IDs and wires them via url(#id)', () => {
    // Render two instances with different random sequences to ensure uniqueness
    mockRandomSequence([0.3333]); // first instance
    const { container, rerender } = render(<LogoGlyph />);
    const defs1 = container.querySelector('defs');
    // ids derive from Math.random().toString(36).slice(2, 8)
    const bubbleGrad1 = defs1.querySelector('linearGradient[id^="cfBubble_"]');
    const shadowFilt1 = defs1.querySelector('filter[id^="cfShadow_"]');
    expect(bubbleGrad1).toBeInTheDocument();
    expect(shadowFilt1).toBeInTheDocument();

    const uidPart1 = bubbleGrad1.id.replace('cfBubble_', '');
    const group1 = container.querySelector('g[filter]');
    expect(group1.getAttribute('filter')).toBe(`url(#cfShadow_${uidPart1})`);

    // There are two bubble paths; one solid fill, one gradient fill using url(#cfBubble_uid)
    const paths1 = container.querySelectorAll('path');
    // First two are the bubble paths; third is the "C"
    const [bubbleSolid1, bubbleGradPath1, cPath1] = paths1;
    expect(bubbleSolid1.getAttribute('fill')).toMatch(/var\(--logo-bubble, #FFA51A\)/);
    expect(bubbleGradPath1.getAttribute('fill')).toBe(`url(#cfBubble_${uidPart1})`);
    // Bubble path "d" should be identical for both paths
    expect(bubbleSolid1.getAttribute('d')).toBe(bubbleGradPath1.getAttribute('d'));

    // Re-render a fresh component (new mount) with a different random value to get a different uid
    restoreRandom();
    mockRandomSequence([0.7777]); // second instance
    const { container: container2 } = render(<LogoGlyph />);
    const bubbleGrad2 = container2.querySelector('linearGradient[id^="cfBubble_"]');
    expect(bubbleGrad2.id).not.toBe(bubbleGrad1.id);
  });

  test('draws the forward-facing "C" with expected stroke attributes', () => {
    mockRandomSequence([0.4444]);
    const { container } = render(<LogoGlyph />);
    const paths = container.querySelectorAll('path');
    // The last path is the stroked "C"
    const cPath = paths[paths.length - 1];

    expect(cPath.getAttribute('fill')).toBe('none');
    expect(cPath.getAttribute('stroke')).toBe('var(--logo-c, #FFFFFF)');
    expect(cPath.getAttribute('stroke-linecap') || cPath.getAttribute('strokeLinecap')).toBe('round');
    expect(cPath.getAttribute('stroke-linejoin') || cPath.getAttribute('strokeLinejoin')).toBe('round');

    // strokeWidth is set from const sw = 30
    // Browsers may stringify numbers; accept either "30" or 30 coerced to string
    expect(cPath.getAttribute('stroke-width') || cPath.getAttribute('strokeWidth')).toBe('30');
  });
});
