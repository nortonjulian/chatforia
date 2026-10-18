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

const flashNode = () => document.querySelector('[data-a11y-call-flash]');
function enableFlash({ reduced = false, visual = false } = {}) {
  mockUser = { ...mockUser, a11yFlashOnCall: true, a11yVisualAlerts: visual };
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.hasFocus.mockReturnValue(true);
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true,
    value: jest.fn(() => ({ matches: reduced, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
}

test('video-first invitation flashes once independently of the banner preference', () => {
  enableFlash();
  render(<VisualAlerts />);
  const invitation = { callId: 1007, callerId: 1, mode: 'VIDEO', offer: null };
  emit('video:incoming', invitation);
  const overlay = flashNode();
  expect(overlay).not.toBeNull();
  expect(overlay).toHaveAttribute('aria-hidden', 'true');
  expect(overlay.style.pointerEvents).toBe('none');
  expect(overlay.style.border).toBe('12px solid rgb(255, 179, 0)');
  expect(overlay.style.boxSizing).toBe('border-box');
  emit('call:incoming', invitation);
  expect(document.querySelectorAll('[data-a11y-call-flash]')).toHaveLength(1);
  expect(notifications.show).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(599));
  expect(flashNode()).toBe(overlay);
  act(() => jest.advanceTimersByTime(1));
  expect(flashNode()).toBeNull();
  emit('video:incoming', invitation);
  expect(flashNode()).toBeNull();
});

test('flash OFF suppresses only the flash, while call banners remain enabled', () => {
  enableFlash({ visual: true }); mockUser.a11yFlashOnCall = false;
  render(<VisualAlerts />);
  emit('call:incoming', { callId: 1007, callerId: 1 });
  expect(flashNode()).toBeNull();
  expect(notifications.show).toHaveBeenCalledTimes(1);
});

test('reduced motion suppresses flash without changing normal call alerts', () => {
  enableFlash({ reduced: true, visual: true });
  render(<VisualAlerts />);
  emit('video:incoming', { callId: 1007, callerId: 1 });
  expect(flashNode()).toBeNull();
  expect(notifications.show).toHaveBeenCalledTimes(1);
});

test('preference changes and account cleanup remove the active overlay', () => {
  enableFlash();
  const { rerender, unmount } = render(<VisualAlerts />);
  emit('call:incoming', { callId: 1007, callerId: 1 });
  expect(flashNode()).not.toBeNull();
  mockUser = { ...mockUser, a11yFlashOnCall: false }; rerender(<VisualAlerts />);
  expect(flashNode()).toBeNull();
  mockUser = { ...mockUser, a11yFlashOnCall: true }; rerender(<VisualAlerts />);
  emit('call:incoming', { callId: 1008, callerId: 1 });
  expect(flashNode()).not.toBeNull();
  mockUser = null; rerender(<VisualAlerts />);
  expect(flashNode()).toBeNull();
  unmount(); expect(jest.getTimerCount()).toBe(0);
});

test('ending or answering the matching call clears the overlay immediately', () => {
  enableFlash(); render(<VisualAlerts />);
  emit('video:incoming', { callId: 1007, callerId: 1 });
  emit('video:ended', { callId: 999 }); expect(flashNode()).not.toBeNull();
  emit('call:ended', { callId: '1007' }); expect(flashNode()).toBeNull();
  emit('call:incoming', { callId: 1008, callerId: 1 });
  emit('call:answer', { callId: 1008 }); expect(flashNode()).toBeNull();
});
