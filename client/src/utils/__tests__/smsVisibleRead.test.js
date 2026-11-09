import { visibleIncomingSmsIds } from '../smsVisibleRead';

const rect = (top, bottom) => ({ top, bottom, left: 0, right: 200 });
const row = (id, top, bottom) => ({
  getAttribute: () => String(id),
  getBoundingClientRect: () => rect(top, bottom),
});
const viewport = (rows) => ({
  getBoundingClientRect: () => rect(0, 100),
  querySelectorAll: () => rows,
});
const foreground = { visibilityState: 'visible', hasFocus: () => true };
const messages = [
  { id: 1, direction: 'out' },
  { id: 2, direction: 'in', createdAt: '2026-11-09T12:00:00.000Z' },
  { id: 3, direction: 'in', createdAt: '2026-11-09T12:00:00.000Z' },
  { id: 4, direction: 'in' },
];

test('returns only distinct visible incoming IDs, including equal-time arrivals', () => {
  expect(visibleIncomingSmsIds(viewport([
    row(1, 10, 30), row(2, 20, 40), row(2, 20, 40),
    row(3, 70, 110), row(4, 110, 140), row(999, 10, 30),
  ]), messages, foreground)).toEqual([2, 3]);
});

test('hidden or unfocused SMS views do not acknowledge messages', () => {
  const view = viewport([row(2, 20, 40)]);
  expect(visibleIncomingSmsIds(view, messages, {
    visibilityState: 'hidden', hasFocus: () => true,
  })).toEqual([]);
  expect(visibleIncomingSmsIds(view, messages, {
    visibilityState: 'visible', hasFocus: () => false,
  })).toEqual([]);
});

test('a message becomes eligible only after its row enters the viewport', () => {
  expect(visibleIncomingSmsIds(viewport([row(4, 110, 140)]), messages, foreground)).toEqual([]);
  expect(visibleIncomingSmsIds(viewport([row(4, 90, 120)]), messages, foreground)).toEqual([4]);
});
