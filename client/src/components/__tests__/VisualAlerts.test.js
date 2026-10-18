import { render, act } from '@testing-library/react';
import VisualAlerts from '../VisualAlerts';
import { notifications } from '@mantine/notifications';

let mockUser;
const mockHandlers = new Map();
const mockSocket = {
  on: jest.fn((event, handler) => {
    if (!mockHandlers.has(event)) mockHandlers.set(event, new Set());
    mockHandlers.get(event).add(handler);
  }),
  off: jest.fn((event, handler) => mockHandlers.get(event)?.delete(handler)),
};
jest.mock('@/context/UserContext', () => ({ useUser: () => ({ currentUser: mockUser }) }));
jest.mock('@/context/SocketContext', () => ({ useSocketRaw: () => mockSocket }));
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key, fallback) => fallback }) }));
const emit = (event, payload) => act(() => {
  for (const handler of mockHandlers.get(event) || []) handler(payload);
});
const incoming = (id) => ({ item: { id, sender: { id: 1 }, createdAt: new Date().toISOString() } });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockHandlers.clear();
  mockUser = { id: 68, a11yVisualAlerts: true };
  document.title = 'Chatforia';
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  jest.spyOn(document, 'hasFocus').mockReturnValue(false);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('incoming aliases show one banner and blink; returning focus restores title', () => {
  render(<VisualAlerts />);
  const message = incoming(42);
  emit('message:upsert', message);
  emit('message:new', message);
  expect(notifications.show).toHaveBeenCalledTimes(1);
  expect(document.title).toContain('New message');
  act(() => jest.advanceTimersByTime(900));
  expect(document.title).toBe('Chatforia');
  act(() => jest.advanceTimersByTime(900));
  expect(document.title).toContain('New message');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.hasFocus.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(document.title).toBe('Chatforia');
});

test('OFF stops alerts immediately and ON does not replay an OFF-period message', () => {
  const { rerender } = render(<VisualAlerts />);
  emit('message:upsert', incoming(42));
  mockUser = { ...mockUser, a11yVisualAlerts: false };
  rerender(<VisualAlerts />);
  expect(document.title).toBe('Chatforia');
  const privatePeriod = incoming(43);
  emit('message:upsert', privatePeriod);
  mockUser = { ...mockUser, a11yVisualAlerts: true };
  rerender(<VisualAlerts />);
  emit('message:new', privatePeriod);
  expect(notifications.show).toHaveBeenCalledTimes(1);
  emit('message:upsert', incoming(44));
  expect(notifications.show).toHaveBeenCalledTimes(2);
});

test('foreground messages get a visual banner without changing the tab title', () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.hasFocus.mockReturnValue(true);
  render(<VisualAlerts />);
  emit('message:upsert', incoming(42));
  expect(notifications.show).toHaveBeenCalledTimes(1);
  expect(document.title).toBe('Chatforia');
});

test('calls alert once and ending the call removes its visual alert', () => {
  render(<VisualAlerts />);
  emit('call:incoming', { callId: 'call-7', callerId: 1 });
  emit('video:incoming', { callId: 'call-7', callerId: 1 });
  expect(notifications.show).toHaveBeenCalledTimes(1);
  expect(document.title).toContain('Incoming call');
  emit('call:ended', { callId: 'call-7' });
  expect(document.title).toBe('Chatforia');
  expect(notifications.hide).toHaveBeenCalledWith('a11y-call-call-7');
});

test('account change and unmount remove listeners and timers', () => {
  const { rerender, unmount } = render(<VisualAlerts />);
  emit('message:upsert', incoming(42));
  mockUser = null;
  rerender(<VisualAlerts />);
  expect(document.title).toBe('Chatforia');
  expect([...mockHandlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
  emit('message:upsert', incoming(43));
  expect(notifications.show).toHaveBeenCalledTimes(1);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});
