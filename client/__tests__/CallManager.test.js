import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import CallManager, { useCall } from '../src/components/CallManager.jsx';

/* -------------------- Hoist-safe shared refs -------------------- */
// Use `var` so jest.mock (hoisted) can assign without TDZ issues.
var mockHandlers = {};
var mockSocket;

var mockPause;
var mockAudioObj;
var mockPlaySound;
var mockUnlockAudio;

var mockGetVolume;
var mockRingtoneUrl;
var mockMessageToneUrl;

/* -------------------- Mocks resolved as if from src/components -------------------- */

// socket: ../lib/socket
jest.mock(
  require.resolve('../lib/socket', {
    paths: [require('path').join(__dirname, '..', 'src', 'components')],
  }),
  () => {
    mockHandlers = {};
    mockSocket = {
      on: jest.fn((event, cb) => {
        mockHandlers[event] = cb;
      }),
      off: jest.fn((event, cb) => {
        if (mockHandlers[event] === cb) delete mockHandlers[event];
      }),
      emit: jest.fn(),
    };
    return mockSocket;
  }
);

// sounds: ../lib/sounds
jest.mock(
  require.resolve('../lib/sounds', {
    paths: [require('path').join(__dirname, '..', 'src', 'components')],
  }),
  () => {
    mockPause = jest.fn();
    mockAudioObj = { pause: mockPause, currentTime: 0 };
    mockPlaySound = jest.fn(() => mockAudioObj);
    mockUnlockAudio = jest.fn();
    return {
      playSound: (...args) => mockPlaySound(...args),
      unlockAudio: (...args) => mockUnlockAudio(...args),
    };
  }
);

// prefs/urls: ../utils/sounds  (mock to avoid import.meta.env in real file)
jest.mock(
  require.resolve('../utils/sounds', {
    paths: [require('path').join(__dirname, '..', 'src', 'components')],
  }),
  () => {
    mockGetVolume = jest.fn(() => 0.7);
    mockRingtoneUrl = jest.fn(() => 'ringtone.mp3');
    mockMessageToneUrl = jest.fn(() => 'message.mp3');
    return {
      getVolume: () => mockGetVolume(),
      ringtoneUrl: () => mockRingtoneUrl(),
      messageToneUrl: () => mockMessageToneUrl(),
    };
  }
);

// user context: ../context/UserContext
jest.mock(
  require.resolve('../context/UserContext', {
    paths: [require('path').join(__dirname, '..', 'src', 'components')],
  }),
  () => ({
    useUser: () => ({ currentUser: { id: 'me-1', username: 'Me' } }),
  })
);

// Mantine → simple primitives
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Noop = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>
      {children}
    </button>
  );
  const Modal = ({ opened, onClose, title, children, ...p }) =>
    opened ? (
      <div role="dialog" aria-label={title} {...p}>
        <button aria-label="close" onClick={onClose} style={{ display: 'none' }} />
        {children}
      </div>
    ) : null;
  const Avatar = (props) => <img alt="avatar" {...props} />;
  return { Modal, Group: Noop, Button, Text: (p) => <p {...p} />, Avatar, Stack: Noop };
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

  // reset event handlers map
  for (const k in mockHandlers) delete mockHandlers[k];

  // reset audio object used by playSound
  if (mockPause) mockPause.mockClear();
  if (mockAudioObj) mockAudioObj.currentTime = 0;

  // ensure doc visible by default
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });

  // predictable prefs
  if (mockGetVolume) mockGetVolume.mockReturnValue(0.7);
  if (mockRingtoneUrl) mockRingtoneUrl.mockReturnValue('ringtone.mp3');
  if (mockMessageToneUrl) mockMessageToneUrl.mockReturnValue('message.mp3');
});

/* -------------------- Tests -------------------- */
describe('CallManager', () => {
  test('registers unlockAudio on first click/touch and calls it', async () => {
    renderWithConsumer();

    await act(async () => {
      window.dispatchEvent(new Event('click'));
    });
    expect(mockUnlockAudio).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('touchstart'));
    });
    expect(mockUnlockAudio).toHaveBeenCalled();
  });

  test('incoming call shows modal and starts ringtone; Accept flow emits accept_call and stops ring', async () => {
    renderWithConsumer();

    const fromUser = { id: 'u2', username: 'Alice', avatarUrl: 'a.png' };
    const roomId = 'room-1';
    await act(async () => {
      mockHandlers['incoming_call']?.({ fromUser, roomId });
    });

    expect(screen.getByRole('dialog', { name: /incoming call/i })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    });

    expect(mockPause).toHaveBeenCalled();
    expect(mockAudioObj.currentTime).toBe(0);

    expect(mockSocket.emit).toHaveBeenCalledWith('accept_call', {
      fromUserId: 'u2',
      roomId: 'room-1',
    });

    expect(screen.queryByRole('dialog', { name: /incoming call/i })).not.toBeInTheDocument();
    expect(screen.getByText(/in call with alice/i)).toBeInTheDocument();
  });

  test('Decline flow emits reject_call and clears incoming', async () => {
    renderWithConsumer();

    await act(async () => {
      mockHandlers['incoming_call']?.({ fromUser: { id: 'u3', username: 'Bob' }, roomId: 'r-2' });
    });
    expect(screen.getByRole('dialog', { name: /incoming call/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    });
    expect(mockSocket.emit).toHaveBeenCalledWith('reject_call', { fromUserId: 'u3' });

    expect(screen.queryByRole('dialog', { name: /incoming call/i })).not.toBeInTheDocument();
  });

  test('Outgoing startCall rings back, emits start_call; then call_accepted sets inCall and clears outgoing', async () => {
    function Trigger() {
      const { startCall } = useCall();
      return <button onClick={() => startCall({ id: 'u9', username: 'Zoe' })}>Start</button>;
    }

    render(
      <CallManager>
        <Trigger />
      </CallManager>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });

    expect(mockPlaySound).toHaveBeenCalledWith(
      'ringtone.mp3',
      expect.objectContaining({ loop: true })
    );
    expect(mockSocket.emit).toHaveBeenCalledWith('start_call', { toUserId: 'u9' });

    await act(async () => {
      mockHandlers['call_accepted']?.({
        peerUser: { id: 'u9', username: 'Zoe' },
        roomId: 'r-accept',
      });
    });

    expect(mockPause).toHaveBeenCalled();
    expect(screen.getByText(/in call with zoe/i)).toBeInTheDocument();
  });

  test('Outgoing call rejected clears outgoing and stops ring', async () => {
    function Trigger() {
      const { startCall } = useCall();
      return <button onClick={() => startCall({ id: 'u10', username: 'Ray' })}>Start</button>;
    }
    render(
      <CallManager>
        <Trigger />
      </CallManager>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await act(async () => {
      mockHandlers['call_rejected']?.();
    });

    expect(mockPause).toHaveBeenCalled();
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('call_cancelled and call_ended stop ringing and clear state', async () => {
    renderWithConsumer();

    await act(async () => {
      mockHandlers['incoming_call']?.({ fromUser: { id: 'u2', username: 'Alice' }, roomId: 'r1' });
    });
    expect(mockPlaySound).toHaveBeenCalled();

    await act(async () => {
      mockHandlers['call_cancelled']?.();
    });
    expect(mockPause).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /incoming call/i })).not.toBeInTheDocument();

    await act(async () => {
      mockHandlers['incoming_call']?.({ fromUser: { id: 'u3', username: 'Bob' }, roomId: 'r2' });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    });
    expect(screen.getByText(/in call with bob/i)).toBeInTheDocument();

    await act(async () => {
      mockHandlers['call_ended']?.();
    });
    expect(mockPause).toHaveBeenCalled();
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('End button emits end_call and clears inCall UI', async () => {
    renderWithConsumer();

    await act(async () => {
      mockHandlers['incoming_call']?.({ fromUser: { id: 'u7', username: 'Nia' }, roomId: 'r7' });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    });
    expect(screen.getByText(/in call with nia/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /end/i }));
    });
    expect(mockSocket.emit).toHaveBeenCalledWith('end_call', {
      peerUserId: 'u7',
      roomId: 'r7',
    });
    expect(screen.queryByText(/in call with/i)).not.toBeInTheDocument();
  });

  test('plays message tone when a message arrives, not mine, while tab is hidden', async () => {
    renderWithConsumer();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    await act(async () => {
      mockHandlers['receive_message']?.({ senderId: 'someone-else' });
    });
    expect(mockPlaySound).toHaveBeenCalledWith(
      'message.mp3',
      expect.objectContaining({ volume: 0.7 })
    );

    mockPlaySound.mockClear();

    await act(async () => {
      mockHandlers['receive_message']?.({ senderId: 'me-1' });
    });
    expect(mockPlaySound).not.toHaveBeenCalled();
  });
});
