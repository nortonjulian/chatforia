// CommonJS so Jest can require it without ESM loader headaches
require('@testing-library/jest-dom');

// ---- Vite envs used in code (now read as process.env by the plugin) ----
process.env.VITE_SOCKET_ORIGIN = process.env.VITE_SOCKET_ORIGIN || 'http://localhost:5002';

// ---- Minimal Media / WebRTC shims for VideoCall ----
class MediaStreamMock { addTrack() {} }
global.MediaStream = MediaStreamMock;

if (!global.navigator) global.navigator = {};
global.navigator.mediaDevices = {
  getUserMedia: jest.fn().mockResolvedValue(new MediaStreamMock()),
};

// Very light RTCPeerConnection mock good enough for unit tests
global.RTCPeerConnection = jest.fn().mockImplementation(() => {
  const pc = {
    addTrack: jest.fn(),
    addIceCandidate: jest.fn(),
    createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0' }),
    setLocalDescription: jest.fn().mockResolvedValue(),
    setRemoteDescription: jest.fn().mockResolvedValue(),
    onicecandidate: null,
    ontrack: null,
    close: jest.fn(),
  };
  // Let tests manually trigger ICE events if needed:
  setTimeout(() => pc.onicecandidate && pc.onicecandidate({ candidate: null }), 0);
  return pc;
});

// ---- Silence Mantine Notifications ESM/CJS edge by stubbing API ----
jest.mock('@mantine/notifications', () => {
  const api = {
    show: jest.fn(),
    hide: jest.fn(),
    update: jest.fn(),
    clean: jest.fn(),
  };
  return { notifications: api, Notifications: () => null };
});

// If your app touches crypto.subtle in tests, keep a stub:
if (!global.crypto) global.crypto = {};
if (!global.crypto.subtle) {
  global.crypto.subtle = {
    // add minimal stubs your code touches, or leave empty
  };
}

/**
 * Global console filters:
 *  - silence React Testing Library's "ReactDOMTestUtils.act is deprecated"
 *  - silence React Router future-flag warnings
 *  - (optional) quiet some frequent DOM prop warnings from design libs
 *
 * We bind the real console methods first so our mocks can delegate safely.
 */
const REAL_ERR = console.error.bind(console);
const REAL_WARN = console.warn.bind(console);

jest.spyOn(console, 'error').mockImplementation((...args) => {
  const msg = String(args[0] ?? '');
  // Use a regex to match the exact deprecation warning regardless of quoting/backticks
  if (/ReactDOMTestUtils\.act is deprecated/i.test(msg)) return;
  if (msg.includes('Not implemented: navigation (except hash changes)')) return;

  REAL_ERR(...args);
});

jest.spyOn(console, 'warn').mockImplementation((...args) => {
  const msg = String(args[0] ?? '');
  // React Router v7 future-flag warnings
  if (msg.includes('React Router Future Flag Warning')) return;

  // Optional: quiet common DOM prop warnings you don't care about in tests
  if (msg.includes('Received `true` for a non-boolean attribute `grow`')) return;
  if (msg.includes('does not recognize the `withinPortal` prop')) return;

  REAL_WARN(...args);
});

// No afterAll restore here on purpose — this file runs per test environment,
// so each test file gets fresh spies automatically.
