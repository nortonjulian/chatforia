// Mock the SAME path your component imports
jest.mock('@/context/CallContext', () => {
  const mockCtx = {
    // Keep shape the component expects, but DO NOT new MediaStream here
    active: { callId: 'test-call' },
    localStream: { current: null },
    remoteStream: { current: null },
    endCall: jest.fn(),
  };
  return {
    useCall: () => mockCtx,
    __mock: { mockCtx },
  };
});

import { render, screen, fireEvent } from '@testing-library/react';
import VideoCall from '@/components/VideoCall.jsx';

// jsdom shims so your effect can set srcObject and call play()
beforeAll(() => {
  Object.defineProperty(global.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: jest.fn().mockResolvedValue(),
  });
  Object.defineProperty(global.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(global.HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    set(_stream) { /* noop for tests */ },
  });

  // Now that the mock module exists, safely inject MediaStreams into it
  const { __mock } = jest.requireMock('@/context/CallContext');
  __mock.mockCtx.localStream.current = new MediaStream();
  __mock.mockCtx.remoteStream.current = new MediaStream();
});

test('renders call UI when active.callId is present', () => {
  render(<VideoCall />);
  expect(screen.getByTitle(/Hang up/i)).toBeInTheDocument();
});

test('can toggle mic and camera and hang up', () => {
  const { __mock } = jest.requireMock('@/context/CallContext');
  render(<VideoCall />);

  // mic toggle
  fireEvent.click(screen.getByRole('button', { name: /Mute/i }));     // becomes "Unmute"
  // camera toggle
  fireEvent.click(screen.getByRole('button', { name: /Camera Off/i })); // becomes "Camera On"

  // end call
  fireEvent.click(screen.getByTitle(/Hang up/i));
  expect(__mock.mockCtx.endCall).toHaveBeenCalled();
});
