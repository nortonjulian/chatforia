import { render, screen } from '@testing-library/react';
import SrOnly from '@/components/SrOnly'; // adjust path if needed

// helper: camelCase -> kebab-case
const toKebab = (s) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

// helper: normalize numeric zeros (0 vs 0px), trim spaces
const normalize = (v) => {
  if (v == null) return v;
  const t = String(v).trim().toLowerCase();
  if (t === '0px') return '0';
  return t.replace(/\s+/g, ' ');
};

// helper: special normalization for clip rect() values
const normalizeClip = (v) =>
  String(v)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/0px/g, '0'); // treat 0px == 0

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

  function expectHasSrOnlyStyles(el) {
    const style = el.style;

    // Check simple properties (normalize 0 vs 0px and whitespace)
    ['position', 'width', 'height', 'padding', 'margin', 'overflow', 'whiteSpace', 'border'].forEach((key) => {
      const cssProp = toKebab(key);
      const got = normalize(style.getPropertyValue(cssProp));
      const want = normalize(requiredStyles[key]);
      expect(got).toBe(want);
    });

    // clip requires extra normalization due to rect(...) formatting differences
    const gotClip = normalizeClip(style.getPropertyValue('clip'));
    const wantClip = normalizeClip(requiredStyles.clip);
    expect(gotClip).toBe(wantClip);
  }

  test('renders as a span by default with visually-hidden styles', () => {
    render(<SrOnly>hidden text</SrOnly>);
    const el = screen.getByText('hidden text');
    expect(el.tagName).toBe('SPAN');
    expectHasSrOnlyStyles(el);
  });

  test('respects the "as" prop (e.g., div) and renders children', () => {
    render(<SrOnly as="div">sr content</SrOnly>);
    const el = screen.getByText('sr content');
    expect(el.tagName).toBe('DIV');
    expectHasSrOnlyStyles(el);
  });
});
