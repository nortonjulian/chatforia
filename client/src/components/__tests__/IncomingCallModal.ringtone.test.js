import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import IncomingCallModal from '../IncomingCallModal';
import { notifications } from '@mantine/notifications';

let mockCall, mockVolume, mockRingtone, mockPlay, mockSounds;
jest.mock('../../context/CallContext', () => ({ useCall: () => mockCall }));
jest.mock('../../utils/sounds', () => ({
  DEFAULTS: { ringtone: 'Classic.mp3' },
  getVolume: () => mockVolume,
  getRingtone: () => mockRingtone,
  listRingtones: plan => (String(plan).toUpperCase() === 'PREMIUM'
    ? ['Classic.mp3', 'Urgency.mp3', 'Chimes.mp3'] : ['Classic.mp3', 'Urgency.mp3']).map(value => ({ value })),
  ringtoneUrl: filename => `/sounds/Ringtones/${filename}`,
}));
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }));
jest.mock('@mantine/core', () => ({
  Modal: ({ children, title }) => <section role="dialog" aria-label={title}>{children}</section>,
  Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Group: ({ children }) => <div>{children}</div>,
  Stack: ({ children }) => <div>{children}</div>,
  Text: ({ children }) => <span>{children}</span>,
}));

const OriginalAudio = global.Audio;
const flush = () => act(async () => { await Promise.resolve(); });
beforeEach(() => {
  jest.clearAllMocks(); mockVolume = 0.35; mockRingtone = 'Chimes.mp3'; mockSounds = [];
  mockPlay = jest.fn(() => Promise.resolve());
  mockCall = { me: { id: 65, plan: 'PREMIUM' }, active: null,
    incoming: { callId: 40, mode: 'VIDEO', callerName: 'Julian' },
    acceptCall: jest.fn(async () => {}), rejectCall: jest.fn(async () => {}) };
  global.Audio = class {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 7; mockSounds.push(this); }
    play() { this.paused = false; return mockPlay(this); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  };
});
afterAll(() => { global.Audio = OriginalAudio; });

test('incoming video loops the saved ringtone at the saved volume', async () => {
  render(<IncomingCallModal />); await flush();
  expect(mockSounds).toHaveLength(1);
  expect(mockSounds[0]).toMatchObject({ src: '/sounds/Ringtones/Chimes.mp3', volume: 0.35, loop: true, paused: false });
  expect(screen.getByRole('dialog', { name: 'Incoming video call' })).toBeInTheDocument();
});
test.each(['AUDIO', 'audio'])('voice calls retain their existing sound owner: %s', async mode => {
  mockCall.incoming.mode = mode;
  render(<IncomingCallModal />); await flush(); expect(mockSounds).toHaveLength(0);
});
test('no incoming call does not allocate sound and a later invitation preserves hook order', async () => {
  const incoming = mockCall.incoming; mockCall.incoming = null;
  const { rerender } = render(<IncomingCallModal />); expect(mockSounds).toHaveLength(0);
  mockCall.incoming = incoming; rerender(<IncomingCallModal />); await flush(); expect(mockSounds).toHaveLength(1);
});
test('duplicate invitation objects and numeric/string aliases keep one ringtone', async () => {
  const { rerender } = render(<IncomingCallModal />); await flush();
  mockCall = { ...mockCall, incoming: { ...mockCall.incoming, callId: '40' } };
  rerender(<IncomingCallModal />); await flush(); expect(mockSounds).toHaveLength(1); expect(mockPlay).toHaveBeenCalledTimes(1);
});
test.each(['Accept', 'Decline'])('%s stops ringing before its backend action finishes', async label => {
  let finish; const action = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  mockCall[label === 'Accept' ? 'acceptCall' : 'rejectCall'] = action;
  const { rerender } = render(<IncomingCallModal />); await flush();
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(action).toHaveBeenCalledTimes(1); expect(mockSounds[0].paused).toBe(true); expect(mockSounds[0].currentTime).toBe(0);
  expect(screen.getByRole('button', { name: label })).toBeDisabled();
  mockCall.incoming = null; rerender(<IncomingCallModal />); await act(async () => finish());
  expect(mockSounds).toHaveLength(1);
});
test('caller cancellation or answered-elsewhere dismissal stops and releases the incoming ringtone', async () => {
  const { rerender } = render(<IncomingCallModal />); await flush();
  mockCall.incoming = null; rerender(<IncomingCallModal />); await flush();
  expect(mockSounds[0]).toMatchObject({ paused: true, currentTime: 0, src: '' });
});
test('becoming active stops ringing even if incoming metadata has not cleared yet', async () => {
  const { rerender } = render(<IncomingCallModal />); await flush();
  mockCall.active = { callId: 40, mode: 'VIDEO' }; rerender(<IncomingCallModal />); await flush();
  expect(mockSounds[0].paused).toBe(true); expect(mockSounds).toHaveLength(1);
});
test('unmount stops ringing', async () => {
  const { unmount } = render(<IncomingCallModal />); await flush(); unmount();
  expect(mockSounds[0]).toMatchObject({ paused: true, currentTime: 0, src: '' });
});
test('a new incoming call stops the old ringer before starting its own', async () => {
  const { rerender } = render(<IncomingCallModal />); await flush();
  mockCall.incoming = { ...mockCall.incoming, callId: 41 }; rerender(<IncomingCallModal />); await flush();
  expect(mockSounds).toHaveLength(2); expect(mockSounds[0].paused).toBe(true); expect(mockSounds[1].paused).toBe(false);
});
test('logout stops ringing and a different account cannot ring a retained old invitation', async () => {
  const { rerender } = render(<IncomingCallModal />); await flush();
  mockCall.me = null; rerender(<IncomingCallModal />); await flush(); expect(mockSounds[0].paused).toBe(true);
  mockCall.me = { id: 68, plan: 'FREE' }; rerender(<IncomingCallModal />); await flush(); expect(mockSounds).toHaveLength(1);
  mockCall.incoming = { ...mockCall.incoming, callId: 41 }; rerender(<IncomingCallModal />); await flush(); expect(mockSounds).toHaveLength(2);
});
test('zero volume stays silent', async () => {
  mockVolume = 0; render(<IncomingCallModal />); await flush(); expect(mockSounds).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Enable ringing' })).toBeNull();
});
test('a Free account falls back from a Premium-only ringtone to Classic', async () => {
  mockCall.me.plan = 'FREE'; render(<IncomingCallModal />); await flush();
  expect(mockSounds[0].src).toBe('/sounds/Ringtones/Classic.mp3');
});
test('blocked autoplay offers a working enable action without creating duplicate audio', async () => {
  mockPlay.mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  render(<IncomingCallModal />); await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Enable ringing' })); await flush();
  expect(mockSounds).toHaveLength(1); expect(mockPlay).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Enable ringing' })).toBeNull();
});
test('a media error is visible and supports an explicit retry', async () => {
  mockPlay.mockRejectedValueOnce(new Error('media failed'));
  render(<IncomingCallModal />); await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Retry ringtone' })); await flush();
  expect(mockSounds).toHaveLength(1); expect(mockPlay).toHaveBeenCalledTimes(2);
});
test('failed answer retains the existing error notice and resumes ringing only for the still-pending invitation', async () => {
  mockCall.acceptCall.mockRejectedValueOnce(new Error('answer failed'));
  render(<IncomingCallModal />); await flush(); fireEvent.click(screen.getByRole('button', { name: 'Accept' })); await flush();
  expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not answer call' }));
  expect(mockSounds).toHaveLength(2); expect(mockSounds[0].paused).toBe(true); expect(mockSounds[1].paused).toBe(false);
});
test('StrictMode cleanup leaves only one playing ringtone', async () => {
  render(<StrictMode><IncomingCallModal /></StrictMode>); await flush();
  expect(mockSounds.filter(sound => !sound.paused)).toHaveLength(1);
});
