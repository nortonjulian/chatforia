// --- Minimal browser shims for WebRTC tests ---

// fetch -> used by /ice-servers
if (!global.fetch) {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ iceServers: [{ urls: 'stun:stun.example.com:3478' }] }),
  });
}

// mediaDevices.getUserMedia -> fake stream
if (!global.navigator) global.navigator = {};
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue({
        getTracks: () => [{ kind: 'video', stop: jest.fn() }, { kind: , stop: jest.fn() }],
      }),
    },
  });
}

// Track created RTCPeerConnection instances so tests can access them
if (!global.__pcs) global.__pcs = [];

// RTCPeerConnection stub with event emit helpers
class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.localDescription = null;
    this.remoteDescription = null;
    this._ontrack = null;
    this._onicecandidate = null;
    global.__pcs.push(this);
  }
  addTrack = jest.fn();
  setRemoteDescription = jest.fn(async (desc) => { this.remoteDescription = desc; });
  createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'v=0 answer' }));
  setLocalDescription = jest.fn(async (desc) => { this.localDescription = desc; });
  close = jest.fn();

  get ontrack() { return this._ontrack; }
  set ontrack(fn) { this._ontrack = fn; }
  get onicecandidate() { return this._onicecandidate; }
  set onicecandidate(fn) { this._onicecandidate = fn; }

  // Test helpers
  _emitTrack(stream) { this._ontrack?.({ streams: [stream] }); }
  _emitIce(candidate) { this._onicecandidate?.({ candidate }); }
}

if (!global.RTCPeerConnection) {
  global.RTCPeerConnection = MockRTCPeerConnection;
}
