import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { CallProvider, useCall } from '@/context/CallContext';

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

jest.mock('@/lib/socket', () => ({
  __esModule: true,
  default: socketMock,
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

  test('on call:answer sets remote description and active if pc exists', async () => {
    renderWithProvider();

    await act(async () => {
      await ctxRef.startCall({
        calleeId: 101,
        mode: 'AUDIO',
      });
    });

    const answer = {
      type: 'answer',
      sdp: 'ans',
    };

    await act(async () => {
      socketMock.emit('call:answer', {
        callId: 'call-123',
        answer,
      });
    });

    expect(ctxRef.active).toEqual(
      expect.objectContaining({
        callId: 'call-123',
        mode: 'AUDIO',
      })
    );

    expect(
      ctxRef.pcRef.current._remoteDescription
    ).toEqual(answer);
  });

  test('on call:candidate forwards candidate to RTCPeerConnection', async () => {
    renderWithProvider();

    await act(async () => {
      await ctxRef.startCall({
        calleeId: 5,
      });
    });

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
      ctxRef.pcRef.current._candidate
    ).toEqual(candidate);
  });

  test('startCall creates peer, gets user media, posts invite, and sets active', async () => {
    renderWithProvider();

    await act(async () => {
      await ctxRef.startCall({
        calleeId: 123,
        mode: 'VIDEO',
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ice-servers?provider=all',
      expect.objectContaining({
        credentials: 'include',
      })
    );

    expect(
      navigator.mediaDevices.getUserMedia
    ).toHaveBeenCalledWith({
      video: true,
      audio: true,
    });

    const inviteCall = fetchMock.mock.calls.find(
      ([url]) => url.includes('/calls/invite')
    );

    expect(inviteCall).toBeTruthy();

    const inviteBody = JSON.parse(
      inviteCall[1].body
    );

    expect(inviteBody).toEqual(
      expect.objectContaining({
        calleeId: 123,
        mode: 'VIDEO',
        offer: expect.objectContaining({
          type: 'offer',
        }),
      })
    );

    expect(ctxRef.active).toEqual({
      callId: 'call-123',
      peerId: 123,
      mode: 'VIDEO',
    });

    expect(
      ctxRef.localStream.current
    ).toBe(userMediaStream);
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

  test('endCall posts end and performs cleanup', async () => {
    renderWithProvider();

    await act(async () => {
      await ctxRef.startCall({
        calleeId: 12,
        mode: 'VIDEO',
      });
    });

    const peerConnection =
      ctxRef.pcRef.current;

    const [audioSender, videoSender] =
      peerConnection.getSenders();

    await act(async () => {
      await ctxRef.endCall();
    });

    const endCall = fetchMock.mock.calls.find(
      ([url]) => url.includes('/calls/end')
    );

    expect(endCall).toBeTruthy();

    expect(peerConnection.closed).toBe(true);

    expect(
      audioSender.track.stop
    ).toHaveBeenCalled();

    expect(
      videoSender.track.stop
    ).toHaveBeenCalled();

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

  test('call:ended socket event triggers cleanup', async () => {
    renderWithProvider();

    await act(async () => {
      await ctxRef.startCall({
        calleeId: 77,
        mode: 'AUDIO',
      });
    });

    await act(async () => {
      socketMock.emit('call:ended');
    });

    expect(ctxRef.active).toBe(null);
    expect(ctxRef.incoming).toBe(null);
    expect(ctxRef.pcRef.current).toBe(null);
  });
});