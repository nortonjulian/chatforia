import { render, screen } from '@testing-library/react';
import SrOnly from '@/components/SrOnly'; // adjust path if needed

describe('SrOnly', () => {
  const requiredStyles = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: '0',
  };

  test('renders as a span by default with visually-hidden styles', () => {
    render(<SrOnly>hidden text</SrOnly>);
    const el = screen.getByText('hidden text');
    expect(el.tagName).toBe('SPAN');

    // Check the important visually-hidden styles
    const style = el.getAttribute('style');
    Object.entries(requiredStyles).forEach(([k, v]) => {
      expect(style).toContain(`${k}: ${v}`);
    });
  });

  test('respects the "as" prop (e.g., div) and renders children', () => {
    render(<SrOnly as="div">sr content</SrOnly>);
    const el = screen.getByText('sr content');
    expect(el.tagName).toBe('DIV');

    // Still has the visually-hidden styles
    const style = el.getAttribute('style');
    Object.entries(requiredStyles).forEach(([k, v]) => {
      expect(style).toContain(`${k}: ${v}`);
    });
  });
});
