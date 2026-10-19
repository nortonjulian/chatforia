import { act, render, screen, fireEvent } from '@testing-library/react';
import VideoCallCaptions from '../VideoCallCaptions';
import { observeVideoCaptions } from '@/utils/videoCaptions';

let mockUser;
let mockCallbacks;
const mockStop = jest.fn();
jest.mock('@/context/UserContext', () => ({ useUser: () => ({ currentUser: mockUser }) }));
jest.mock('@/api/axiosClient', () => ({ __esModule: true, default: {} }));
jest.mock('@/utils/videoCaptions', () => ({ observeVideoCaptions: jest.fn(options => { mockCallbacks = options; return mockStop; }) }));
const remoteStream = { current: {} };
beforeEach(() => {
  jest.clearAllMocks(); mockCallbacks = null;
  mockUser = { id: 65, isPremium: true, a11yLiveCaptions: true, a11yCaptionFont: 'lg', a11yCaptionBg: 'dark' };
});
test('actual received caption text renders with the saved appearance', () => {
  render(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  expect(observeVideoCaptions).toHaveBeenCalledWith(expect.objectContaining({ callId: 20, remoteStream }));
  act(() => { mockCallbacks.onStatus('ready'); mockCallbacks.onText('Remote caller speech'); });
  expect(screen.getByRole('status')).toHaveTextContent('Remote caller speech');
  expect(screen.getByRole('status')).toHaveStyle({ fontSize: '1.25rem', pointerEvents: 'none' });
});
test('appearance changes apply without restarting caption capture', () => {
  const { rerender } = render(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  act(() => mockCallbacks.onText('Caption'));
  mockUser = { ...mockUser, a11yCaptionFont: 'xl', a11yCaptionBg: 'light' };
  rerender(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  expect(screen.getByRole('status')).toHaveStyle({ fontSize: '1.5rem', color: '#111' });
  expect(observeVideoCaptions).toHaveBeenCalledTimes(1);
});
test.each([{ isPremium: false }, { a11yLiveCaptions: false }, { id: null }])('ineligible or disabled viewer does not capture audio: %j', change => {
  mockUser = { ...mockUser, ...change };
  render(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  expect(observeVideoCaptions).not.toHaveBeenCalled(); expect(screen.queryByRole('status')).toBeNull();
});
test('call change clears old text and ignores late delivery', () => {
  const { rerender } = render(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  const old = mockCallbacks; act(() => old.onText('Old call text'));
  rerender(<VideoCallCaptions callId={21} remoteStream={remoteStream} />);
  expect(mockStop).toHaveBeenCalledTimes(1);
  act(() => old.onText('Late old text'));
  expect(screen.queryByText('Late old text')).toBeNull(); expect(screen.queryByText('Old call text')).toBeNull();
});
test('account change and saved OFF remove text and release caption resources', () => {
  const { rerender, unmount } = render(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  act(() => mockCallbacks.onText('Account A'));
  mockUser = { ...mockUser, id: 68 };
  rerender(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  expect(screen.queryByText('Account A')).toBeNull();
  act(() => mockCallbacks.onText('Account B'));
  mockUser = { ...mockUser, a11yLiveCaptions: false };
  rerender(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  expect(screen.queryByRole('status')).toBeNull();
  mockUser = { ...mockUser, a11yLiveCaptions: true };
  rerender(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  expect(screen.queryByText('Account B')).toBeNull(); unmount(); expect(mockStop).toHaveBeenCalledTimes(3);
});
test('provider failure has a retry action which starts a fresh scoped capture', () => {
  render(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  act(() => { mockCallbacks.onText(''); mockCallbacks.onStatus('error'); });
  fireEvent.click(screen.getByRole('button', { name: 'Retry captions' }));
  expect(mockStop).toHaveBeenCalledTimes(1); expect(observeVideoCaptions).toHaveBeenCalledTimes(2);
  act(() => mockCallbacks.onText('Recovered caption'));
  expect(screen.getByRole('status')).toHaveTextContent('Recovered caption');
});
test('caption markup is displayed literally', () => {
  render(<VideoCallCaptions callId={20} remoteStream={remoteStream} />);
  act(() => mockCallbacks.onText('<img src=x onerror=alert(1)>'));
  expect(screen.getByRole('status').querySelector('img')).toBeNull();
});
