import { isAtMessageBottom } from '../chatScrollPosition.js';

const viewport = (remaining) => ({
  scrollHeight: 1000,
  clientHeight: 400,
  scrollTop: 600 - remaining,
});

test('follows media resizing when at the bottom', () => {
  expect(isAtMessageBottom(viewport(0))).toBe(true);
  expect(isAtMessageBottom(viewport(10))).toBe(true);
  expect(isAtMessageBottom(viewport(16))).toBe(true);
});

test('does not snap back after intentionally scrolling upward', () => {
  expect(isAtMessageBottom(viewport(17))).toBe(false);
  expect(isAtMessageBottom(viewport(60))).toBe(false);
  expect(isAtMessageBottom(viewport(120))).toBe(false);
});

test('handles absent viewports safely', () => {
  expect(isAtMessageBottom(null)).toBe(false);
});
