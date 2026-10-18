import { act, render, screen } from '@testing-library/react';
import CallCaptions from '../CallCaptions';

let mockUser;
let mockSocket;
jest.mock('@/context/UserContext', () => ({ useUser: () => ({ currentUser: mockUser }) }));
jest.mock('@/context/SocketContext', () => ({ useSocketRaw: () => mockSocket }));

const emit = (event) => act(() => {
  for (const handler of [...mockSocket.handlers]) handler(event);
});
beforeEach(() => {
  mockUser = { id: 65, isPremium: true, a11yLiveCaptions: true, a11yCaptionFont: 'lg', a11yCaptionBg: 'dark' };
  mockSocket = { handlers: new Set(),
    on: jest.fn((_event, handler) => mockSocket.handlers.add(handler)),
    off: jest.fn((_event, handler) => mockSocket.handlers.delete(handler)),
  };
});

test('shows actual socket text; partial and final segments replace rather than duplicate', () => {
  render(<CallCaptions callId={1027} />);
  emit({ callId: '1027', text: 'This is', isFinal: false });
  expect(screen.getByRole('status')).toHaveTextContent('This is');
  emit({ callId: 1027, text: 'This is a test.', isFinal: true });
  emit({ callId: 1027, text: 'This is a test.', isFinal: true });
  expect(screen.getByRole('status').textContent).toBe('This is a test.');
});

test('uses saved font and background, and updates appearance without resetting text', () => {
  const { rerender } = render(<CallCaptions callId={1027} />);
  emit({ callId: 1027, text: 'Caption' });
  expect(screen.getByRole('status')).toHaveStyle({ fontSize: '1.25rem', color: '#fff', pointerEvents: 'none' });
  mockUser = { ...mockUser, a11yCaptionFont: 'xl', a11yCaptionBg: 'light' };
  rerender(<CallCaptions callId={1027} />);
  expect(screen.getByRole('status')).toHaveStyle({ fontSize: '1.5rem', color: '#111' });
  expect(screen.getByRole('status')).toHaveTextContent('Caption');
});

test('ignores another call, blank and malformed payloads; renders markup as text', () => {
  render(<CallCaptions callId={1027} />);
  emit({ callId: 1028, text: 'Wrong call' }); emit(null); emit({ callId: 1027, text: {} });
  expect(screen.queryByRole('status')).toBeNull();
  emit({ callId: 1027, text: '<img src=x onerror=alert(1)>' });
  expect(screen.getByRole('status').querySelector('img')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('<img');
});

test.each([false, undefined])('non-Premium flag %s prevents subscription', (isPremium) => {
  mockUser = { ...mockUser, plan: 'FREE', isPremium };
  render(<CallCaptions callId={1027} />);
  expect(mockSocket.on).not.toHaveBeenCalled();
});

test('OFF, call change, account change and unmount clear private text and listeners', () => {
  const { rerender, unmount } = render(<CallCaptions callId={1027} />);
  emit({ callId: 1027, text: 'Old call' });
  const late = [...mockSocket.handlers][0];
  rerender(<CallCaptions callId={1028} />);
  act(() => late({ callId: 1027, text: 'Late text' }));
  expect(screen.queryByRole('status')).toBeNull();
  emit({ callId: 1028, text: 'New call' });
  mockUser = { ...mockUser, id: 68 };
  rerender(<CallCaptions callId={1028} />);
  expect(screen.queryByRole('status')).toBeNull();
  emit({ callId: 1028, text: 'New account' });
  mockUser = { ...mockUser, a11yLiveCaptions: false };
  rerender(<CallCaptions callId={1028} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(mockSocket.handlers.size).toBe(0);
  unmount();
  expect(mockSocket.handlers.size).toBe(0);
});
