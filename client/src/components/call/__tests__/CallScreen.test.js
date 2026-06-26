import {
  render,
  screen,
  fireEvent,
} from '@testing-library/react';

// Mock the participant modal so this unit test does not
// load axiosClient and its import.meta expression.
jest.mock(
  '@/components/call/AddCallParticipantModal',
  () => ({
    __esModule: true,
    default: () => null,
  })
);

// Mock analytics used by CallScreen.
jest.mock('@/utils/analytics', () => ({
  __esModule: true,
  default: {
    capture: jest.fn(),
  },
}));

let mockUseCall = () => ({
  active: null,
  status: 'idle',
  localStream: {
    current: null,
  },
  remoteStream: {
    current: null,
  },
  participants: [],
  addParticipant: undefined,
  me: {
    id: 1,
  },
  endCall: jest.fn(),
});

jest.mock('@/context/CallContext', () => ({
  useCall: () => mockUseCall(),
}));

import CallScreen from '@/components/call/CallScreen';

function makeStream(name) {
  return {
    __mockStream: name,
  };
}

describe('CallScreen', () => {
  afterEach(() => {
    jest.clearAllMocks();

    mockUseCall = () => ({
      active: null,
      status: 'idle',
      localStream: {
        current: null,
      },
      remoteStream: {
        current: null,
      },
      participants: [],
      addParticipant: undefined,
      me: {
        id: 1,
      },
      endCall: jest.fn(),
    });
  });

  test('returns null when there is no active call', () => {
    const { container } = render(
      <CallScreen />
    );

    expect(
      container
    ).toBeEmptyDOMElement();
  });

  test('VIDEO mode renders local and remote videos and assigns srcObject', () => {
    const local = {
      current: makeStream('local'),
    };

    const remote = {
      current: makeStream('remote'),
    };

    const endCall = jest.fn();

    mockUseCall = () => ({
      active: {
        mode: 'VIDEO',
        peerUser: {
          id: 'u2',
        },
      },
      status: 'connected',
      localStream: local,
      remoteStream: remote,
      participants: [],
      addParticipant: undefined,
      me: {
        id: 1,
      },
      endCall,
    });

    const { container } = render(
      <CallScreen />
    );

    const videos =
      container.querySelectorAll('video');

    expect(videos).toHaveLength(2);

    const [remoteVideo, localVideo] = videos;

    expect(
      remoteVideo.className
    ).not.toMatch(/\bhidden\b/);

    expect(
      localVideo.className
    ).not.toMatch(/\bhidden\b/);

    expect(remoteVideo.srcObject).toBe(
      remote.current
    );

    expect(localVideo.srcObject).toBe(
      local.current
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /end call/i,
      })
    );

    expect(endCall).toHaveBeenCalledTimes(1);
    expect(endCall).toHaveBeenCalledWith(
      'hangup'
    );
  });

  test('AUDIO mode hides videos and shows status text', () => {
    mockUseCall = () => ({
      active: {
        mode: 'AUDIO',
        peerUser: {
          id: '77',
        },
      },
      status: 'ringing',
      localStream: {
        current: null,
      },
      remoteStream: {
        current: null,
      },
      participants: [],
      addParticipant: undefined,
      me: {
        id: 1,
      },
      endCall: jest.fn(),
    });

    const { container } = render(
      <CallScreen />
    );

    const videos =
      container.querySelectorAll('video');

    expect(videos).toHaveLength(2);

    const [remoteVideo, localVideo] = videos;

    expect(
      remoteVideo.className
    ).toMatch(/\bhidden\b/);

    expect(
      localVideo.className
    ).toMatch(/\bhidden\b/);

    expect(
      screen.getByText(/audio call — ringing/i)
    ).toBeInTheDocument();
  });

  test('updates video srcObject when stream refs change', () => {
    const localRef = {
      current: null,
    };

    const remoteRef = {
      current: makeStream('r1'),
    };

    mockUseCall = () => ({
      active: {
        mode: 'VIDEO',
        peerUser: {
          id: 'u2',
        },
      },
      status: 'connected',
      localStream: localRef,
      remoteStream: remoteRef,
      participants: [],
      addParticipant: undefined,
      me: {
        id: 1,
      },
      endCall: jest.fn(),
    });

    const { container, rerender } = render(
      <CallScreen />
    );

    let [remoteVideo, localVideo] =
      container.querySelectorAll('video');

    expect(remoteVideo.srcObject).toBe(
      remoteRef.current
    );

    expect(
      localVideo.srcObject
    ).toBeUndefined();

    const newLocalRef = {
      current: makeStream('l2'),
    };

    mockUseCall = () => ({
      active: {
        mode: 'VIDEO',
        peerUser: {
          id: 'u2',
        },
      },
      status: 'connected',
      localStream: newLocalRef,
      remoteStream: remoteRef,
      participants: [],
      addParticipant: undefined,
      me: {
        id: 1,
      },
      endCall: jest.fn(),
    });

    rerender(<CallScreen />);

    [remoteVideo, localVideo] =
      container.querySelectorAll('video');

    expect(localVideo.srcObject).toBe(
      newLocalRef.current
    );

    const newRemoteRef = {
      current: makeStream('r2'),
    };

    mockUseCall = () => ({
      active: {
        mode: 'VIDEO',
        peerUser: {
          id: 'u2',
        },
      },
      status: 'connected',
      localStream: newLocalRef,
      remoteStream: newRemoteRef,
      participants: [],
      addParticipant: undefined,
      me: {
        id: 1,
      },
      endCall: jest.fn(),
    });

    rerender(<CallScreen />);

    [remoteVideo, localVideo] =
      container.querySelectorAll('video');

    expect(remoteVideo.srcObject).toBe(
      newRemoteRef.current
    );
  });
});