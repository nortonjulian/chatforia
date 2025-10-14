import { render, screen, fireEvent } from '@testing-library/react';
import CallManager, { useCall } from '@/components/CallManager.jsx';

/* -------------------- Mocks -------------------- */

// Socket mock with event map (names prefixed with "mock" to satisfy Jest's rule)
const mockHandlers = {};
const mockSocket = {
  on: jest.fn((event, cb) => { mockHandlers[event] = cb; }),
  off: jest.fn((event, cb) => { if (mockHandlers[event] === cb) delete mockHandlers[event]; }),
  emit: jest.fn(),
};

// Resolve modules **as if imported from the component file**
const path = require('path');
const componentDir = path.dirname(require.resolve('../src/components/CallManager.jsx'));

// Socket
jest.mock(
  require.resolve('../lib/socket', { paths: [componentDir] }),
  () => mockSocket
);

// Sound + prefs
const mockPause = jest.fn();
let mockAudioObj = { pause: mockPause, currentTime: 0 };
const mockPlaySound = jest.fn(() => mockAudioObj);
const mockUnlockAudio = jest.fn();
const mockGetVolume = jest.fn(() => 0.7);
const mockRingtoneUrl = jest.fn(() => 'ringtone.mp3');
const mockMessageToneUrl = jest.fn(() => 'message.mp3');

jest.mock(
  require.resolve('../lib/sound', { paths: [componentDir] }),
  () => ({
    playSound: (...args) => mockPlaySound(...args),
    unlockAudio: (...args) => mockUnlockAudio(...args),
  })
);

jest.mock(
  require.resolve('../lib/soundPrefs', { paths: [componentDir] }),
  () => ({
    getVolume: () => mockGetVolume(),
    ringtoneUrl: () => mockRingtoneUrl(),
    messageToneUrl: () => mockMessageToneUrl(),
  })
);

// User context
jest.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: { id: 'me-1', username: 'Me' } }),
}));

// Mantine components → simple primitives
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Noop = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );
  const Modal = ({ opened, onClose, title, children, ...p }) =>
    opened ? (
      <div role="dialog" aria-label={title} {...p}>
        <button aria-label="close" onClick={onClose} style={{ display: 'none' }} />
        {children}
      </div>
    ) : null;

  const Avatar = (props) => <img alt="avatar" {...props} />;
  return {
    Modal,
    Group: Noop,
    Button,
    Text: (p) => <p {...p} />,
    Avatar,
    Stack: Noop,
  };
});

/* -------------------- Utilities -------------------- */
function renderWithConsumer() {
  function Consumer() {
    const ctx = useCall();
    return (
      <div data-testid="ctx">
        {ctx?.incoming && <span data-testid="has-incoming">yes</span>}
        {ctx?.outgoing && <span data-testid="has-outgoing">yes</span>}
        {ctx?.inCall && <span data-testid="has-incall">yes</span>}
      </div>
    );
  }
  return render(
    <CallManager>
      <Consumer />
    </CallManager>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockHandlers)) delete mockHandlers[k];

  // Reset audio object used by playSound
  mockPause.mockClear();
  mockAudioObj = { pause: mockPause, currentTime: 0 };

  // Ensure document is visible by default
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

/* -------------------- Tests -------------------- */
describe('CallManager', () => {
  test('registers unlockAudio on first click/touch and calls it', () => {
    renderWithConsumer();
    window.dispatchEvent(new Event('click'));
    expect(mockUnlockAudio).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('touchstart'));
    expect(mockUnlockAudio).toHaveBeenCalled(); // still >= 1
  });

  test('incoming call shows modal and starts ringtone; Accept flow emits accept_call and stops ring', () => {
    renderWithConsumer();

    // Receive incoming call
    const fromUser = { id: 'u2', username: 'Alice', avatarUrl: 'a.png' };
    const roomId = 'room-1';
    mockHandlers['incoming_call']?.({ fromUser, roomId });

    // Modal shows caller
    expect(screen.getByRole('dialog', { name: /incoming call/i })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();

    // Ringtone played with loop
    expect(mockPlaySound).toHaveBeenCalledWith('ringtone.mp3', expect.objectContaining({ volume: 0.7, loop: true }));

    // Accept
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    // Should pause + reset ring
    expect(mockPause).toHaveBeenCalled();
    expect(mockAudioObj.currentTime).toBe(0);

    // Emits accept_call with ids + room
    expect(mockSocket.emit).toHaveBeenCalledWith('accept_call', {
      fromUserId: 'u2',
      roomId: 'room-1',
    });

    // Modal closed; in-call pill visible
    expect(screen.queryByRole('dialog', { name: /incoming call/i })).not.toBeInTheDocument();
    expect(screen.getByText(/in call with alice/i)).toBeInTheDocument();
  });

  test('Decline flow emits reject_call and clears incoming', () => {
    renderWithConsumer();

    mockHandlers['incoming_call']?.({ fromUser: { id: 'u3', username: 'Bob' }, roomId: 'r-2' });
    expect(screen.getByRole('dialog', { name: /incoming call/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(mockSocket.emit).toHaveBeenCalledWith('reject_call', { fromUserId: 'u3' });

    expect(screen.queryByRole('dialog', { name: /incoming call/i })).not.toBeInTheDocument();
  });

  test('Outgoing startCall rings back, emits start_call; then call_accepted sets inCall and clears outgoing', () => {
    function Trigger() {
      const { startCall } = useCall();
      return <button onClick={() => startCall({ id: 'u9', username: 'Zoe' })}>Start</button>;
    }

    render(
      <CallManager>
        <Trigger />
      </CallManager>
    );

    fireEvent.click(screen.getByText('Start'));

    // Ringback and emit
    expect(mockPlaySound).toHaveBeenCalledWith('ringtone.mp3', expect.objectContaining({ loop: true }));
    expect(mockSocket.emit).toHaveBeenCalledWith('start_call', { toUserId: 'u9' });

    // Simulate remote acceptance
    mockHandlers['call_accepted']?.({ peerUser: { id: 'u9', username: 'Zoe' }, roomId: 'r-accept' });

    // Ring should stop
    expect(mockPause).toHaveBeenCalled();

    // In-call pill appears, outgoing cleared
    expect(screen.getByText(/in call with zoe/i)).toBeInTheDocument();
  });

  test('Outgoing call rejected clears outgoing and stops ring', () => {
    function Trigger() {
      const { startCall } = useCall();
      return <button onClick={() => startCall({ id: 'u10', username: 'Ray' })}>Start</button>;
    }
    render(
      <CallManager>
        <Trigger />
      </CallManager>
    );

    fireEvent.click(screen.getByText('Start'));
    mockHandlers['call_rejected']?.();

    expect(mockPause).toHaveBeenCalled();
    // No in-call UI
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('call_cancelled and call_ended stop ringing and clear state', () => {
    renderWithConsumer();

    // Incoming then cancelled
    mockHandlers['incoming_call']?.({ fromUser: { id: 'u2', username: 'Alice' }, roomId: 'r1' });
    expect(mockPlaySound).toHaveBeenCalled();
    mockHandlers['call_cancelled']?.();
    expect(mockPause).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /incoming call/i })).not.toBeInTheDocument();

    // Simulate in-call, then ended
    mockHandlers['incoming_call']?.({ fromUser: { id: 'u3', username: 'Bob' }, roomId: 'r2' });
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    expect(screen.getByText(/in call with bob/i)).toBeInTheDocument();

    mockHandlers['call_ended']?.();
    expect(mockPause).toHaveBeenCalled();
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('End button emits end_call and clears inCall UI', () => {
    renderWithConsumer();

    // Enter an in-call state via incoming+accept
    mockHandlers['incoming_call']?.({ fromUser: { id: 'u7', username: 'Nia' }, roomId: 'r7' });
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    expect(screen.getByText(/in call with nia/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /end/i }));
    expect(mockSocket.emit).toHaveBeenCalledWith('end_call', { peerUserId: 'u7', roomId: 'r7' });
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('plays message tone when a message arrives, not mine, while tab is hidden', () => {
    renderWithConsumer();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    // From someone else
    mockHandlers['receive_message']?.({ senderId: 'someone-else' });
    expect(mockPlaySound).toHaveBeenCalledWith('message.mp3', expect.objectContaining({ volume: 0.7 }));

    // From me -> no extra play
    mockPlaySound.mockClear();
    mockHandlers['receive_message']?.({ senderId: 'me-1' });
    expect(mockPlaySound).not.toHaveBeenCalled();
  });
});
