import { render, screen, fireEvent } from '@testing-library/react';
import CallScreen from '@/components/call/CallScreen';

// ---- Mocks ----
let mockUseCall = () => ({
  active: null,
  status: 'idle',
  localStream: { current: null },
  remoteStream: { current: null },
  endCall: jest.fn(),
});

jest.mock('@/context/CallContext', () => ({
  useCall: () => mockUseCall(),
}));

// Create a minimal MediaStream mock
function makeStream(name) {
  return { __mockStream: name };
}

describe('CallScreen', () => {
  afterEach(() => {
    // reset default impl
    mockUseCall = () => ({
      active: null,
      status: 'idle',
      localStream: { current: null },
      remoteStream: { current: null },
      endCall: jest.fn(),
    });
  });

  test('returns null when there is no active call', () => {
    const { container } = render(<CallScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  test('VIDEO mode: renders local & remote videos and assigns srcObject', () => {
    const local = { current: makeStream('local') };
    const remote = { current: makeStream('remote') };
    const endCall = jest.fn();

    mockUseCall = () => ({
      active: { mode: 'VIDEO', peerUser: { id: 'u2' } },
      status: 'connected',
      localStream: local,
      remoteStream: remote,
      endCall,
    });

    const { container } = render(<CallScreen />);

    // Remote video visible
    const videos = container.querySelectorAll('video');
    expect(videos.length).toBe(2);
    const [remoteVid, localVid] = videos;

    // classNames should NOT include 'hidden' in video mode
    expect(remoteVid.className).not.toMatch(/\bhidden\b/);
    expect(localVid.className).not.toMatch(/\bhidden\b/);

    // srcObject assigned from refs
    expect(remoteVid.srcObject).toBe(remote.current);
    expect(localVid.srcObject).toBe(local.current);

    // End Call button
    fireEvent.click(screen.getByRole('button', { name: /end call/i }));
    expect(endCall).toHaveBeenCalledTimes(1);
  });

  test('AUDIO mode: hides videos and shows status text with peer id', () => {
    mockUseCall = () => ({
      active: { mode: 'AUDIO', peerUser: { id: '77' } },
      status: 'ringing',
      localStream: { current: null },
      remoteStream: { current: null },
      endCall: jest.fn(),
    });

    const { container } = render(<CallScreen />);

    const videos = container.querySelectorAll('video');
    expect(videos.length).toBe(2);
    const [remoteVid, localVid] = videos;
    expect(remoteVid.className).toMatch(/\bhidden\b/);
    expect(localVid.className).toMatch(/\bhidden\b/);

    expect(screen.getByText(/Audio call with User 77 — ringing/i)).toBeInTheDocument();
  });

  test('updates video srcObject when stream refs change', () => {
    // Start with only remote
    const localRef = { current: null };
    const remoteRef = { current: makeStream('r1') };

    mockUseCall = () => ({
      active: { mode: 'VIDEO', peerUser: { id: 'u2' } },
      status: 'connected',
      localStream: localRef,
      remoteStream: remoteRef,
      endCall: jest.fn(),
    });

    const { container, rerender } = render(<CallScreen />);
    let [remoteVid, localVid] = container.querySelectorAll('video');
    expect(remoteVid.srcObject).toBe(remoteRef.current);
    expect(localVid.srcObject).toBe(null);

    // Change local stream and re-render with a new ref object
    const newLocal = { current: makeStream('l2') };
    mockUseCall = () => ({
      active: { mode: 'VIDEO', peerUser: { id: 'u2' } },
      status: 'connected',
      localStream: newLocal,
      remoteStream: remoteRef,
      endCall: jest.fn(),
    });
    rerender(<CallScreen />);

    [remoteVid, localVid] = container.querySelectorAll('video');
    expect(localVid.srcObject).toBe(newLocal.current);

    // Change remote stream too
    const newRemote = { current: makeStream('r2') };
    mockUseCall = () => ({
      active: { mode: 'VIDEO', peerUser: { id: 'u2' } },
      status: 'connected',
      localStream: newLocal,
      remoteStream: newRemote,
      endCall: jest.fn(),
    });
    rerender(<CallScreen />);

    [remoteVid, localVid] = container.querySelectorAll('video');
    expect(remoteVid.srcObject).toBe(newRemote.current);
  });
});
