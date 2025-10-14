import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';

// ---- Global/WebRTC/Fetch mocks ----
class MockMediaStream {
  constructor() { this._tracks = []; }
  addTrack(t) { this._tracks.push(t); }
  getTracks() { return this._tracks; }
  removeTrack(t) { this._tracks = this._tracks.filter(x => x !== t); }
}

const makeTrack = (id) => ({ id, stop: jest.fn() });

class MockRTCPeerConnection {
  constructor(cfg) {
    this.cfg = cfg;
    this._senders = [{ track: makeTrack('audio1') }, { track: makeTrack('video1') }];
    this.onicecandidate = null;
    this.ontrack = null;
    this._localDescription = null;
    this._remoteDescription = null;
    this.closed = false;
  }
  addTrack(track, stream) { /* no-op for test */ }
  getSenders() { return this._senders; }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' }; }
  async setLocalDescription(desc) { this._localDescription = desc; }
  async setRemoteDescription(desc) { this._remoteDescription = desc; }
  async addIceCandidate(cand) { this._candidate = cand; }
  close() { this.closed = true; }
}

global.RTCPeerConnection = MockRTCPeerConnection;
global.MediaStream = MockMediaStream;

const userMediaStream = new MockMediaStream();
userMediaStream.addTrack(makeTrack('aud-local'));
userMediaStream.addTrack(makeTrack('vid-local'));
Object.defineProperty(global.navigator, 'mediaDevices', {
  value: { getUserMedia: jest.fn().mockResolvedValue(userMediaStream) },
  configurable: true,
});

// Fetch mock that routes by URL
const fetchMock = jest.fn(async (url, opts = {}) => {
  if (url.includes('/ice-servers')) {
    return { json: async () => ({ iceServers: [{ urls: 'stun:stun.example.org' }] }) };
  }
  if (url.includes('/calls/invite')) {
    return { json: async () => ({ callId: 'call-123' }) };
  }
  if (url.includes('/calls/answer')) {
    return { json: async () => ({ ok: true }) };
  }
  if (url.includes('/calls/end')) {
    return { json: async () => ({ ok: true }) };
  }
  if (url.includes('/calls/candidate')) {
    return { json: async () => ({ ok: true }) };
  }
  return { json: async () => ({}) };
});
global.fetch = fetchMock;

// ---- Module mocks ----
const listeners = {};
const socketMock = {
  on: (ev, cb) => { listeners[ev] = listeners[ev] || []; listeners[ev].push(cb); },
  off: (ev, cb) => {
    if (!listeners[ev]) return;
    listeners[ev] = listeners[ev].filter((x) => x !== cb);
  },
  emit: (ev, payload) => { (listeners[ev] || []).forEach((cb) => cb(payload)); },
};
jest.mock('@/lib/socket', () => ({ __esModule: true, default: socketMock }));
jest.mock('@/config', () => ({ __esModule: true, API_BASE: '/api' }));

// ---- SUT ----
// Use alias import (preferred). If you don't have moduleNameMapper for "@",
// change this to:  import { CallProvider, useCall } from '../CallContext';
import { CallProvider, useCall } from '@/context/CallContext';

// Convenience harness to grab context API
let ctxRef;
function Harness({ children }) {
  const ctx = useCall();
  useEffect(() => { ctxRef = ctx; });
  return children || null;
}

function renderWithProvider(ui = null, props = {}) {
  return render(
    <CallProvider me={{ id: 7, ...props.me }}>
      <Harness />
      {ui}
    </CallProvider>
  );
}

beforeEach(() => {
  ctxRef = null;
  fetchMock.mockClear();
  Object.keys(listeners).forEach((k) => delete listeners[k]); // reset socket listeners
  navigator.mediaDevices.getUserMedia.mockClear();
});

describe('CallContext', () => {
  test('registers socket listeners and updates incoming on call:incoming', () => {
    renderWithProvider();
    expect(listeners['call:incoming']).toBeTruthy();

    const payload = { callId: 'in-1', fromUser: { id: 99 }, mode: 'VIDEO', offer: { type: 'offer' } };
    act(() => socketMock.emit('call:incoming', payload));

    expect(ctxRef.incoming).toEqual(payload);
  });

  test('on call:answer sets remote description and active if pc exists', async () => {
    renderWithProvider();

    // Create a peer first to populate pcRef.current
    await act(async () => {
      await ctxRef.startCall({ calleeId: 101, mode: 'AUDIO' });
    });

    const answer = { type: 'answer', sdp: 'ans' };
    await act(async () => {
      socketMock.emit('call:answer', { callId: 'call-123', answer });
    });

    expect(ctxRef.active).toEqual(expect.objectContaining({ callId: 'call-123' }));
    expect(ctxRef.pcRef.current._remoteDescription).toEqual(answer);
  });

  test('on call:candidate forwards candidate to RTCPeerConnection', async () => {
    renderWithProvider();
    await act(async () => {
      await ctxRef.startCall({ calleeId: 5 });
    });
    const cand = { candidate: 'abc', sdpMid: '0', sdpMLineIndex: 0 };
    await act(async () => {
      socketMock.emit('call:candidate', { candidate: cand });
    });
    expect(ctxRef.pcRef.current._candidate).toEqual(cand);
  });

  test('startCall creates peer, gets user media, posts invite, and sets active', async () => {
    renderWithProvider();

    await act(async () => {
      await ctxRef.startCall({ calleeId: 123, mode: 'VIDEO' });
    });

    // ice servers fetched
    expect(fetchMock).toHaveBeenCalledWith('/api/ice-servers?provider=all', expect.objectContaining({ credentials: 'include' }));
    // user media requested with video true, audio true
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    // invite sent
    const inviteCall = fetchMock.mock.calls.find(([u]) => u.includes('/calls/invite'));
    expect(inviteCall).toBeTruthy();
    const inviteBody = JSON.parse(inviteCall[1].body);
    expect(inviteBody).toEqual(expect.objectContaining({
      calleeId: 123,
      mode: 'VIDEO',
      offer: expect.objectContaining({ type: 'offer' }),
    }));
    // active set with response callId and peerId
    expect(ctxRef.active).toEqual({ callId: 'call-123', peerId: 123 });
    // local stream set
    expect(ctxRef.localStream.current).toBe(userMediaStream);
  });

  test('acceptCall consumes incoming offer, sends answer, sets active and clears incoming', async () => {
    renderWithProvider();
    const incoming = {
      callId: 'in-99',
      fromUser: { id: 456 },
      mode: 'AUDIO',
      offer: { type: 'offer', sdp: 'incoming-offer' },
    };

    // Simulate incoming socket event
    act(() => socketMock.emit('call:incoming', incoming));
    expect(ctxRef.incoming).toEqual(incoming);

    await act(async () => {
      await ctxRef.acceptCall();
    });

    // checks: user media called with video false due to AUDIO
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: false, audio: true });

    // answer posted
    const answerCall = fetchMock.mock.calls.find(([u]) => u.includes('/calls/answer'));
    expect(answerCall).toBeTruthy();
    const answerBody = JSON.parse(answerCall[1].body);
    expect(answerBody).toEqual(expect.objectContaining({
      callId: 'in-99',
      answer: expect.objectContaining({ type: 'answer' }),
    }));

    // active state updated and incoming cleared
    expect(ctxRef.active).toEqual({ callId: 'in-99', peerId: 456 });
    expect(ctxRef.incoming).toBe(null);
  });

  test('rejectCall posts end and clears incoming', async () => {
    renderWithProvider();
    act(() => socketMock.emit('call:incoming', { callId: 'rej-1', fromUser: { id: 9 }, mode: 'VIDEO', offer: {} }));

    await act(async () => { await ctxRef.rejectCall(); });

    const endCall = fetchMock.mock.calls.find(([u]) => u.includes('/calls/end'));
    expect(endCall).toBeTruthy();
    const body = JSON.parse(endCall[1].body);
    expect(body).toEqual({ callId: 'rej-1', reason: 'rejected' });
    expect(ctxRef.incoming).toBe(null);
  });

  test('endCall posts end and performs cleanup (tracks stopped, pc closed, state reset)', async () => {
    renderWithProvider();
    await act(async () => {
      await ctxRef.startCall({ calleeId: 12, mode: 'VIDEO' });
    });

    const pc = ctxRef.pcRef.current;
    const senders = pc.getSenders();
    const [s1, s2] = senders;

    await act(async () => {
      await ctxRef.endCall();
    });

    const endCall = fetchMock.mock.calls.find(([u]) => u.includes('/calls/end'));
    expect(endCall).toBeTruthy();
    expect(pc.closed).toBe(true); // closed by cleanup
    expect(s1.track.stop).toHaveBeenCalled();
    expect(s2.track.stop).toHaveBeenCalled();
    expect(ctxRef.active).toBe(null);
    expect(ctxRef.incoming).toBe(null);
    // remote stream instance reset
    expect(ctxRef.remoteStream.current).toBeInstanceOf(MockMediaStream);
    expect(ctxRef.remoteStream.current.getTracks()).toHaveLength(0);
    // local stream cleared
    expect(ctxRef.localStream.current).toBe(null);
  });

  test('call:ended socket event triggers cleanup', async () => {
    renderWithProvider();
    await act(async () => { await ctxRef.startCall({ calleeId: 77, mode: 'AUDIO' }); });

    // Simulate server signaling end
    await act(async () => { socketMock.emit('call:ended'); });

    expect(ctxRef.active).toBe(null);
    expect(ctxRef.incoming).toBe(null);
    expect(ctxRef.pcRef.current).toBe(null);
  });
});
