import { render, screen } from '@testing-library/react';
import CaptionOverlay from '@/components/CaptionOverlay'; // update path if needed

describe('CaptionOverlay', () => {
  test('renders placeholder when no segments provided', () => {
    render(<CaptionOverlay />);
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  test('renders only the last 3 segment texts joined by spaces', () => {
    const segments = [
      { text: 'alpha' },
      { text: 'beta' },
      { text: 'gamma' },
      { text: 'delta' },
    ];
    render(<CaptionOverlay segments={segments} />);
    // Expect "beta gamma delta"
    expect(screen.getByText('beta gamma delta')).toBeInTheDocument();
  });

  test('applies default font class (lg) when no font prop given', () => {
    render(<CaptionOverlay segments={[{ text: 'hello' }]} />);
    const bubble = screen.getByText('hello');
    expect(bubble.className).toContain('text-lg');
  });

  test('applies font class based on font prop (sm, md, lg, xl)', () => {
    const { rerender } = render(<CaptionOverlay segments={[{ text: 'x' }]} font="sm" />);
    expect(screen.getByText('x').className).toContain('text-sm');

    rerender(<CaptionOverlay segments={[{ text: 'y' }]} font="md" />);
    expect(screen.getByText('y').className).toContain('text-base');

    rerender(<CaptionOverlay segments={[{ text: 'z' }]} font="xl" />);
    expect(screen.getByText('z').className).toContain('text-xl');
  });

  test('falls back to lg font when unknown font key is provided', () => {
    render(<CaptionOverlay segments={[{ text: 'fallback' }]} font="unknown" />);
    expect(screen.getByText('fallback').className).toContain('text-lg');
  });

  test('uses dark background classes by default', () => {
    render(<CaptionOverlay segments={[{ text: 'dark' }]} />);
    const bubble = screen.getByText('dark');
    expect(bubble.className).toContain('bg-black/70');
    expect(bubble.className).toContain('text-white');
  });

  test('uses light background classes when bg="light"', () => {
    render(<CaptionOverlay segments={[{ text: 'light' }]} bg="light" />);
    const bubble = screen.getByText('light');
    expect(bubble.className).toContain('bg-white/90');
    expect(bubble.className).toContain('text-black');
  });

  test('uses transparent style when bg is anything else', () => {
    render(<CaptionOverlay segments={[{ text: 'glass' }]} bg="glass" />);
    const bubble = screen.getByText('glass');
    expect(bubble.className).toContain('bg-transparent');
    expect(bubble.className).toContain('text-white');
    expect(bubble.className).toContain('drop-shadow');
  });

  test('applies className to the outer wrapper', () => {
    render(<CaptionOverlay segments={[{ text: 'outer' }]} className="custom-wrapper" />);
    const wrapper = document.querySelector('.custom-wrapper');
    expect(wrapper).toBeInTheDocument();
    // sanity check: wrapper keeps positioning/utility classes
    expect(wrapper.className).toContain('pointer-events-none');
    expect(wrapper.className).toContain('absolute');
  });
});
