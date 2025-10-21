import { render, cleanup, waitFor, act } from '@testing-library/react';
import VideoCall from '../VideoCall.jsx'; // relative to __tests__ → video

// ---- Minimal fake Twilio room and helpers ----
function makeTrack() {
  return {
    attach: () => {
      const el = document.createElement('video');
      return el;
    },
    detach: () => {
      const el = document.createElement('video');
      return [el];
    },
    stop: jest.fn(),
  };
}

function makeTrackPublication() {
  return { track: makeTrack(), on: jest.fn() };
}

function makeLocalParticipant() {
  const tracks = new Map([['cam', makeTrackPublication()]]);
  return {
    tracks,
    on: jest.fn(), // listens for 'trackPublished'
  };
}

function makeRoom() {
  const localParticipant = makeLocalParticipant();
  const participants = new Map();

  const listeners = {};
  const on = (event, cb) => {
    listeners[event] = listeners[event] || [];
    listeners[event].push(cb);
  };
  const emit = (event, ...args) => {
    (listeners[event] || []).forEach((cb) => cb(...args));
  };

  return {
    localParticipant,
    participants,
    on,
    _emit: emit, // test-only helper to simulate events
    disconnect: jest.fn(),
  };
}

// Recreate a fresh room per test to avoid cross-test state
let mockRoom;

jest.mock('../video', () => ({
  __esModule: true,
  joinRoom: jest.fn(async () => mockRoom),
}));

import { joinRoom } from '../video';

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('renders two containers and calls joinRoom with identity & room', async () => {
  mockRoom = makeRoom();

  const onEnd = jest.fn();
  render(<VideoCall identity="alice" room="room-1" onEnd={onEnd} />);

  // wait for effect -> joinRoom
  await waitFor(() => expect(joinRoom).toHaveBeenCalledWith({ identity: 'alice', room: 'room-1' }));

  const containers = document.querySelectorAll('.rounded.border.p-1');
  expect(containers.length).toBe(2);
  expect(onEnd).not.toHaveBeenCalled();
});

test('fires onEnd when room emits "disconnected"', async () => {
  mockRoom = makeRoom();

  const onEnd = jest.fn();
  render(<VideoCall identity="bob" room="room-2" onEnd={onEnd} />);

  // ensure listeners are attached
  await waitFor(() => expect(joinRoom).toHaveBeenCalled());

  // emit inside act to flush effects
  await act(async () => {
    mockRoom._emit('disconnected');
  });

  expect(onEnd).toHaveBeenCalledTimes(1);
});

test('cleanup on unmount stops tracks and disconnects room', async () => {
  mockRoom = makeRoom();

  const onEnd = jest.fn();
  const { unmount } = render(<VideoCall identity="carol" room="room-3" onEnd={onEnd} />);

  // ensure room is set in effect
  await waitFor(() => expect(joinRoom).toHaveBeenCalled());

  unmount();

  // Local track was stopped
  const pub = [...mockRoom.localParticipant.tracks.values()][0];
  expect(pub.track.stop).toHaveBeenCalled();

  // Room disconnected
  expect(mockRoom.disconnect).toHaveBeenCalled();

  // onEnd called on manual unmount
  expect(onEnd).toHaveBeenCalled();
});
