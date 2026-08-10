import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { CallProvider, useCall } from '@/context/CallContext';

const mockStartBrowserCall = jest.fn();
const mockTwilioHangup = jest.fn();

const mockTwilioVoiceState = {
  ready: true,
  initializing: false,
  calling: false,
  callStatus: 'idle',
  error: null,
  currentCall: null,
  startBrowserCall:
    mockStartBrowserCall,
  hangup: mockTwilioHangup,
};

jest.mock(
  '@/hooks/useTwilioVoice',
  () => ({
    useTwilioVoice: () =>
      mockTwilioVoiceState,
  })
);

const mockJoinRoom = jest.fn();
let mockVideoRoom;
let mockTwilioLocalTrack;

jest.mock(
'@/video/video',
() => ({
joinRoom: (...args) =>
mockJoinRoom(...args),
})
);

// WebRTC and fetch mocks
class MockMediaStream {
  constructor() {
    this._tracks = [];
  }

  addTrack(track) {
    this._tracks.push(track);
  }

  getTracks() {
    return this._tracks;
  }

  removeTrack(track) {
    this._tracks = this._tracks.filter(
      (existingTrack) => existingTrack !== track
    );
  }
}

const makeTrack = (id) => ({
  id,
  stop: jest.fn(),
});

class MockRTCPeerConnection {
  constructor(config) {
    this.cfg = config;

    this._senders = [
      { track: makeTrack('audio1') },
      { track: makeTrack('video1') },
    ];

    this.onicecandidate = null;
    this.ontrack = null;
    this._localDescription = null;
    this._remoteDescription = null;
    this._candidate = null;
    this.closed = false;
  }

  addTrack() {}

  getSenders() {
    return this._senders;
  }

  getReceivers() {
    return [];
  }

  async createOffer() {
    return {
      type: 'offer',
      sdp: 'offer-sdp',
    };
  }

  async createAnswer() {
    return {
      type: 'answer',
      sdp: 'answer-sdp',
    };
  }

  async setLocalDescription(description) {
    this._localDescription = description;
  }

  async setRemoteDescription(description) {
    this._remoteDescription = description;
  }

  async addIceCandidate(candidate) {
    this._candidate = candidate;
  }

  close() {
    this.closed = true;
  }
}

global.RTCPeerConnection = MockRTCPeerConnection;
global.MediaStream = MockMediaStream;

const userMediaStream = new MockMediaStream();

userMediaStream.addTrack(makeTrack('aud-local'));
userMediaStream.addTrack(makeTrack('vid-local'));

Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia: jest
      .fn()
      .mockResolvedValue(userMediaStream),
  },
  configurable: true,
});

const fetchMock = jest.fn(async (url) => {
  if (url.includes('/ice-servers')) {
    return {
      ok: true,
      json: async () => ({
        iceServers: [
          {
            urls: 'stun:stun.example.org',
          },
        ],
      }),
    };
  }

  if (url.includes('/calls/invite')) {
    return {
      ok: true,
      json: async () => ({
        callId: 'call-123',
      }),
    };
  }

  if (url.includes('/calls/answer')) {
    return {
      ok: true,
      json: async () => ({
        ok: true,
      }),
    };
  }

  if (url.includes('/calls/end')) {
    return {
      ok: true,
      json: async () => ({
        ok: true,
      }),
    };
  }

  if (url.includes('/calls/candidate')) {
    return {
      ok: true,
      json: async () => ({
        ok: true,
      }),
    };
  }

  return {
    ok: true,
    json: async () => ({}),
  };
});

global.fetch = fetchMock;

// Socket mock
const listeners = {};

const socketMock = {
  on: (event, callback) => {
    listeners[event] = listeners[event] || [];
    listeners[event].push(callback);
  },

  off: (event, callback) => {
    if (!listeners[event]) {
      return;
    }

    listeners[event] = listeners[event].filter(
      (listener) => listener !== callback
    );
  },

  emit: (event, payload) => {
    (listeners[event] || []).forEach((callback) => {
      callback(payload);
    });
  },
};

jest.mock('@/context/SocketContext', () => ({
  __esModule: true,
  useSocketRaw: () => socketMock,
}));

jest.mock('@/config', () => ({
  __esModule: true,
  API_BASE: '/api',
}));

// Test harness
let ctxRef;

function Harness() {
  const context = useCall();

  useEffect(() => {
    ctxRef = context;
  });

  return null;
}

function renderWithProvider(props = {}) {
  return render(
    <CallProvider
      me={{
        id: 7,
        ...props.me,
      }}
    >
      <Harness />
    </CallProvider>
  );
}

beforeEach(() => {
  ctxRef = null;

mockTwilioLocalTrack = {
mediaStreamTrack:
makeTrack('twilio-video-local'),
stop: jest.fn(),
};

mockVideoRoom = {
localParticipant: {
tracks: new Map([
[
'local-video',
{
track: mockTwilioLocalTrack,
},
],
]),
},
participants: new Map(),
on: jest.fn(),
disconnect: jest.fn(),
};

mockJoinRoom.mockReset();
mockJoinRoom.mockResolvedValue(
mockVideoRoom
);

  mockStartBrowserCall.mockReset();
  mockStartBrowserCall.mockResolvedValue({});
  mockTwilioHangup.mockReset();
  mockTwilioVoiceState.callStatus = 'idle';
  mockTwilioVoiceState.error = null;

  fetchMock.mockClear();
  navigator.mediaDevices.getUserMedia.mockClear();

  Object.keys(listeners).forEach((key) => {
    delete listeners[key];
  });
});

describe('CallContext', () => {
  test('registers socket listeners and updates incoming on call:incoming', () => {
    renderWithProvider();

    expect(
      listeners['call:incoming']
    ).toBeTruthy();

    const payload = {
      callId: 'in-1',
      fromUser: {
        id: 99,
      },
      mode: 'VIDEO',
      offer: {
        type: 'offer',
      },
    };

    act(() => {
      socketMock.emit('call:incoming', payload);
    });

    expect(ctxRef.incoming).toEqual(payload);
  });

  test('on call:answer updates an existing legacy incoming peer', async () => {
renderWithProvider();

act(() => {
socketMock.emit('call:incoming', {
callId: 'incoming-video-1',
fromUser: {
id: 101,
},
mode: 'VIDEO',
offer: {
type: 'offer',
sdp: 'incoming-offer',
},
});
});

await act(async () => {
await ctxRef.acceptCall();
});

const peerConnection =
ctxRef.pcRef.current;

expect(peerConnection).toBeTruthy();

const answer = {
type: 'answer',
sdp: 'ans',
};

await act(async () => {
socketMock.emit('call:answer', {
callId: 'incoming-video-1',
answer,
});
});

expect(
peerConnection._remoteDescription
).toEqual(answer);
});

test('on call:candidate forwards a candidate to an existing legacy incoming peer', async () => {
renderWithProvider();

act(() => {
socketMock.emit('call:incoming', {
callId: 'incoming-video-2',
fromUser: {
id: 5,
},
mode: 'VIDEO',
offer: {
type: 'offer',
sdp: 'incoming-offer',
},
});
});

await act(async () => {
await ctxRef.acceptCall();
});

const peerConnection =
ctxRef.pcRef.current;

expect(peerConnection).toBeTruthy();

const candidate = {
candidate: 'abc',
sdpMid: '0',
sdpMLineIndex: 0,
};

await act(async () => {
socketMock.emit('call:candidate', {
candidate,
});
});

expect(
peerConnection._candidate
).toEqual(candidate);
});

test('startCall routes app video through the canonical Twilio Video room', async () => {
renderWithProvider();

await act(async () => {
await ctxRef.startCall({
calleeId: 123,
mode: 'VIDEO',
peerName: 'Reviewer',
});
});

const inviteCall =
fetchMock.mock.calls.find(
([url]) =>
url.includes('/calls/invite')
);

expect(inviteCall).toBeTruthy();

expect(
JSON.parse(inviteCall[1].body)
).toEqual({
calleeId: 123,
mode: 'VIDEO',
offer: null,
});

expect(mockJoinRoom).toHaveBeenCalledWith({
identity: '7',
room: 'call_call-123',
});

expect(
navigator.mediaDevices.getUserMedia
).not.toHaveBeenCalled();

expect(fetchMock).not.toHaveBeenCalledWith(
'/api/ice-servers?provider=all',
expect.anything()
);

expect(ctxRef.active).toMatchObject({
callId: 'call-123',
peerId: 123,
mode: 'VIDEO',
peerName: 'Reviewer',
roomName: 'call_call-123',
mediaTransport: 'twilio-video',
});

expect(
ctxRef.localStream.current
.getTracks()
).toContain(
mockTwilioLocalTrack.mediaStreamTrack
);
});

test('startCall routes app audio through Twilio Voice with the backend call ID', async () => {
  renderWithProvider();

  await act(async () => {
    await ctxRef.startCall({
      calleeId: 123,
      mode: 'AUDIO',
      peerName: 'Reviewer',
    });
  });

  const inviteCall =
    fetchMock.mock.calls.find(
      ([url]) =>
        url.includes('/calls/invite')
    );

  expect(inviteCall).toBeTruthy();

  expect(
    JSON.parse(inviteCall[1].body)
  ).toEqual({
    calleeId: 123,
    mode: 'AUDIO',
    offer: null,
  });

  expect(
    mockStartBrowserCall
  ).toHaveBeenCalledWith(
    '123',
    {
      backendCallId: 'call-123',
    }
  );

  expect(
    navigator.mediaDevices.getUserMedia
  ).not.toHaveBeenCalled();

  expect(ctxRef.active).toEqual({
    callId: 'call-123',
    peerId: 123,
    mode: 'AUDIO',
    peerName: 'Reviewer',
    mediaTransport: 'twilio-voice',
  });
});

test('acceptCall consumes incoming offer, sends answer, sets active and clears incoming', async () => {
    renderWithProvider();

    const incoming = {
      callId: 'in-99',
      fromUser: {
        id: 456,
      },
      mode: 'AUDIO',
      offer: {
        type: 'offer',
        sdp: 'incoming-offer',
      },
    };

    act(() => {
      socketMock.emit('call:incoming', incoming);
    });

    expect(ctxRef.incoming).toEqual(incoming);

    await act(async () => {
      await ctxRef.acceptCall();
    });

    expect(
      navigator.mediaDevices.getUserMedia
    ).toHaveBeenCalledWith({
      video: false,
      audio: true,
    });

    const answerCall = fetchMock.mock.calls.find(
      ([url]) => url.includes('/calls/answer')
    );

    expect(answerCall).toBeTruthy();

    const answerBody = JSON.parse(
      answerCall[1].body
    );

    expect(answerBody).toEqual(
      expect.objectContaining({
        callId: 'in-99',
        answer: expect.objectContaining({
          type: 'answer',
        }),
      })
    );

    expect(ctxRef.active).toEqual({
      callId: 'in-99',
      peerId: 456,
      peerName: 'Chatforia user',
      mode: 'AUDIO',
    });

    expect(ctxRef.incoming).toBe(null);
  });

  test('rejectCall posts end and clears incoming', async () => {
    renderWithProvider();

    act(() => {
      socketMock.emit('call:incoming', {
        callId: 'rej-1',
        fromUser: {
          id: 9,
        },
        mode: 'VIDEO',
        offer: {},
      });
    });

    await act(async () => {
      await ctxRef.rejectCall();
    });

    const endCall = fetchMock.mock.calls.find(
      ([url]) => url.includes('/calls/end')
    );

    expect(endCall).toBeTruthy();

    const body = JSON.parse(endCall[1].body);

    expect(body).toEqual({
      callId: 'rej-1',
      reason: 'rejected',
    });

    expect(ctxRef.incoming).toBe(null);
  });

  test('endCall disconnects Twilio Video and stops local media', async () => {
renderWithProvider();

await act(async () => {
await ctxRef.startCall({
calleeId: 12,
mode: 'VIDEO',
peerName: 'Reviewer',
});
});

await act(async () => {
await ctxRef.endCall('hangup');
});

const endCall =
fetchMock.mock.calls.find(
([url]) =>
url.includes('/calls/end')
);

expect(endCall).toBeTruthy();

expect(
mockTwilioLocalTrack.stop
).toHaveBeenCalledTimes(1);

expect(
mockVideoRoom.disconnect
).toHaveBeenCalledTimes(1);

expect(ctxRef.active).toBe(null);
expect(ctxRef.incoming).toBe(null);

expect(
ctxRef.remoteStream.current
).toBeInstanceOf(MockMediaStream);

expect(
ctxRef.remoteStream.current.getTracks()
).toHaveLength(0);

expect(
ctxRef.localStream.current
).toBe(null);
});


test('outgoing audio call cleans up immediately when callee declines', async () => {
  renderWithProvider();

  await act(async () => {
    await ctxRef.startCall({
      calleeId: 24,
      mode: 'AUDIO',
      peerName: 'Reviewer',
    });
  });

  expect(ctxRef.active).toMatchObject({
    callId: 'call-123',
    peerId: 24,
    mode: 'AUDIO',
    mediaTransport: 'twilio-voice',
  });

  mockTwilioHangup.mockClear();

  act(() => {
    socketMock.emit('call:ended', {
      callId: 'call-123',
      status: 'DECLINED',
    });
  });

  expect(mockTwilioHangup).toHaveBeenCalledTimes(1);
  expect(ctxRef.active).toBeNull();
  expect(ctxRef.pending).toBe(false);
  expect(ctxRef.status).toBeNull();
});

test(
  'outgoing audio timeout keeps call UI active during voicemail without hanging up Twilio',
  async () => {
    renderWithProvider();

    await act(async () => {
      await ctxRef.startCall({
        calleeId: 24,
        mode: 'AUDIO',
        peerName: 'Reviewer',
      });
    });

    expect(ctxRef.active).toMatchObject({
      callId: 'call-123',
      peerId: 24,
      mode: 'AUDIO',
      mediaTransport: 'twilio-voice',
    });

    mockTwilioHangup.mockClear();

    act(() => {
      socketMock.emit('call:ended', {
        callId: 'call-123',
        status: 'MISSED',
        reason: 'no_answer',
      });
    });

    expect(
      mockTwilioHangup
    ).not.toHaveBeenCalled();

    expect(ctxRef.active).toMatchObject({
      callId: 'call-123',
      peerId: 24,
      mode: 'AUDIO',
      mediaTransport: 'twilio-voice',
    });

    expect(ctxRef.pending).toBe(false);
    expect(ctxRef.status).toBe('Voicemail');
  }
);

test('call:ended socket event triggers cleanup', async () => {
    renderWithProvider();

    await act(async () => {
      await ctxRef.startCall({
        calleeId: 77,
        mode: 'AUDIO',
      });
    });

    await act(async () => {
      socketMock.emit('call:ended', {
        callId: 'call-123',
      });
    });

    expect(ctxRef.active).toBe(null);
    expect(ctxRef.incoming).toBe(null);
    expect(ctxRef.pcRef.current).toBe(null);
  });

test(
  'ignores answered-elsewhere while this browser answer is pending',
  async () => {
    renderWithProvider();

    act(() => {
      socketMock.emit('call:incoming', {
        callId: 'answer-here-1',
        fromUser: {
          id: 24,
        },
        mode: 'AUDIO',
        offer: {
          type: 'offer',
          sdp: 'incoming-offer',
        },
      });
    });

    let resolveAnswerResponse;

    const answerResponse =
      new Promise((resolve) => {
        resolveAnswerResponse = resolve;
      });

    fetchMock
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          iceServers: [],
        }),
      }))
      .mockImplementationOnce(
        async () => answerResponse
      );

    let acceptPromise;

    await act(async () => {
      acceptPromise = ctxRef.acceptCall();
      await Promise.resolve();
    });

    act(() => {
      socketMock.emit('call:ended', {
        callId: 'answer-here-1',
        status: 'ANSWERED_ELSEWHERE',
      });
    });

    expect(ctxRef.incoming).not.toBe(null);
    expect(ctxRef.pcRef.current).not.toBe(null);

    resolveAnswerResponse({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        callId: 'answer-here-1',
        status: 'ACTIVE',
      }),
    });

    await act(async () => {
      await acceptPromise;
    });

    expect(ctxRef.active).toEqual(
      expect.objectContaining({
        callId: 'answer-here-1',
      })
    );

    expect(ctxRef.incoming).toBe(null);
  }
);

test(
  'cleans up when another device wins the answer claim',
  async () => {
    renderWithProvider();

    act(() => {
      socketMock.emit('call:incoming', {
        callId: 'answered-elsewhere-1',
        fromUser: {
          id: 24,
        },
        mode: 'VIDEO',
        offer: {
          type: 'offer',
          sdp: 'incoming-offer',
        },
      });
    });

    fetchMock
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          iceServers: [],
        }),
      }))
      .mockImplementationOnce(async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          error:
            'This call was answered on another device.',
          code:
            'CALL_ANSWERED_ELSEWHERE',
        }),
      }));

    await act(async () => {
      await ctxRef.acceptCall();
    });

    expect(ctxRef.active).toBe(null);
    expect(ctxRef.incoming).toBe(null);
    expect(ctxRef.pcRef.current).toBe(null);
    expect(ctxRef.localStream.current).toBe(null);
  }
);

});
