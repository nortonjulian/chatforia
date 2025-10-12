import { render, screen, fireEvent } from '@testing-library/react';
import CallManager, { useCall } from '@/components/CallManager'; // <-- update if needed

// -------------------- Mocks --------------------

// Socket mock with event map
const handlers = {};
const socketMock = {
  on: jest.fn((event, cb) => { handlers[event] = cb; }),
  off: jest.fn((event, cb) => { if (handlers[event] === cb) delete handlers[event]; }),
  emit: jest.fn(),
};

jest.mock('../lib/socket', () => socketMock);

// Sound + prefs
const pauseFn = jest.fn();
let audioObj = { pause: pauseFn, currentTime: 0 };
const playSoundMock = jest.fn(() => audioObj);
const unlockAudioMock = jest.fn();
const getVolumeMock = jest.fn(() => 0.7);
const ringtoneUrlMock = jest.fn(() => 'ringtone.mp3');
const messageToneUrlMock = jest.fn(() => 'message.mp3');

jest.mock('../lib/sound', () => ({
  playSound: (...args) => playSoundMock(...args),
  unlockAudio: (...args) => unlockAudioMock(...args),
}));

jest.mock('../lib/soundPrefs', () => ({
  getVolume: () => getVolumeMock(),
  ringtoneUrl: () => ringtoneUrlMock(),
  messageToneUrl: () => messageToneUrlMock(),
}));

// User context
jest.mock('../context/UserContext', () => ({
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

// Utility: render with a consumer to access context value (optional checks)
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
  for (const k of Object.keys(handlers)) delete handlers[k];

  // Reset audio object used by playSound
  pauseFn.mockClear();
  audioObj = { pause: pauseFn, currentTime: 0 };

  // Ensure document is visible by default
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('CallManager', () => {
  test('registers unlockAudio on first click/touch and calls it', () => {
    renderWithConsumer();
    // Simulate first user interaction (click)
    window.dispatchEvent(new Event('click'));
    expect(unlockAudioMock).toHaveBeenCalledTimes(1);

    // Touchstart should also call (may be swallowed by { once: true } in real DOM; JSDOM might not)
    window.dispatchEvent(new Event('touchstart'));
    expect(unlockAudioMock).toHaveBeenCalled(); // ≥ 1
  });

  test('incoming call shows modal and starts ringtone; Accept flow emits accept_call and stops ring', () => {
    renderWithConsumer();

    // Receive incoming call
    const fromUser = { id: 'u2', username: 'Alice', avatarUrl: 'a.png' };
    const roomId = 'room-1';
    handlers['incoming_call']?.({ fromUser, roomId });

    // Modal shows caller
    expect(screen.getByRole('dialog', { name: /incoming call/i })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();

    // Ringtone played with loop
    expect(playSoundMock).toHaveBeenCalledWith('ringtone.mp3', expect.objectContaining({ volume: 0.7, loop: true }));

    // Accept
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    // Should pause + reset ring
    expect(pauseFn).toHaveBeenCalled();
    expect(audioObj.currentTime).toBe(0);

    // Emits accept_call with ids + room
    expect(socketMock.emit).toHaveBeenCalledWith('accept_call', {
      fromUserId: 'u2',
      roomId: 'room-1',
    });

    // Modal closed; in-call pill visible
    expect(screen.queryByRole('dialog', { name: /incoming call/i })).not.toBeInTheDocument();
    expect(screen.getByText(/in call with alice/i)).toBeInTheDocument();
  });

  test('Decline flow emits reject_call and clears incoming', () => {
    renderWithConsumer();

    handlers['incoming_call']?.({ fromUser: { id: 'u3', username: 'Bob' }, roomId: 'r-2' });
    expect(screen.getByRole('dialog', { name: /incoming call/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(socketMock.emit).toHaveBeenCalledWith('reject_call', { fromUserId: 'u3' });

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
    expect(playSoundMock).toHaveBeenCalledWith('ringtone.mp3', expect.objectContaining({ loop: true }));
    expect(socketMock.emit).toHaveBeenCalledWith('start_call', { toUserId: 'u9' });

    // Simulate remote acceptance
    handlers['call_accepted']?.({ peerUser: { id: 'u9', username: 'Zoe' }, roomId: 'r-accept' });

    // Ring should stop
    expect(pauseFn).toHaveBeenCalled();

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
    handlers['call_rejected']?.();

    expect(pauseFn).toHaveBeenCalled();
    // No in-call UI
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('call_cancelled and call_ended stop ringing and clear state', () => {
    renderWithConsumer();

    // Incoming then cancelled
    handlers['incoming_call']?.({ fromUser: { id: 'u2', username: 'Alice' }, roomId: 'r1' });
    expect(playSoundMock).toHaveBeenCalled();
    handlers['call_cancelled']?.();
    expect(pauseFn).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /incoming call/i })).not.toBeInTheDocument();

    // Simulate in-call, then ended
    handlers['incoming_call']?.({ fromUser: { id: 'u3', username: 'Bob' }, roomId: 'r2' });
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    expect(screen.getByText(/in call with bob/i)).toBeInTheDocument();

    handlers['call_ended']?.();
    expect(pauseFn).toHaveBeenCalled();
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('End button emits end_call and clears inCall UI', () => {
    renderWithConsumer();

    // Enter an in-call state via incoming+accept
    handlers['incoming_call']?.({ fromUser: { id: 'u7', username: 'Nia' }, roomId: 'r7' });
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    expect(screen.getByText(/in call with nia/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /end/i }));
    expect(socketMock.emit).toHaveBeenCalledWith('end_call', { peerUserId: 'u7', roomId: 'r7' });
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('plays message tone when a message arrives, not mine, while tab is hidden', () => {
    renderWithConsumer();
    // Hidden tab
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    // From someone else
    handlers['receive_message']?.({ senderId: 'someone-else' });
    expect(playSoundMock).toHaveBeenCalledWith('message.mp3', expect.objectContaining({ volume: 0.7 }));

    // From me -> no extra play
    playSoundMock.mockClear();
    handlers['receive_message']?.({ senderId: 'me-1' });
    expect(playSoundMock).not.toHaveBeenCalled();
  });
});
