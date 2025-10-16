import { render, screen, fireEvent } from '@testing-library/react';

// ---- Mantine stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...p }) => (
    <div data-testid={tid} {...p}>{children}</div>
  );
  const Select = ({ label, data = [], value, onChange, w }) => (
    <div data-testid={`select-${label}`} data-value={value} data-w={w}>
      {data.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-testid={`opt-${label}-${opt.value}`}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
  const Button = ({ children, onClick }) => <button onClick={onClick}>{children}</button>;
  const Group = passthru('group');
  const Stack = passthru('stack');
  const Title = passthru('title');
  const Divider = passthru('divider');
  const Text = passthru('text');
  return { __esModule: true, Select, Group, Button, Stack, Title, Divider, Text };
});

// ---- Icons not needed ----
jest.mock('@tabler/icons-react', () => ({ __esModule: true, IconPlayerPlay: () => <i /> }));

// ---- sounds utils (define mocks inside the factory) ----
jest.mock('@/utils/sounds', () => ({
  __esModule: true,
  listMessageTones: jest.fn(),
  listRingtones: jest.fn(),
  getMessageTone: jest.fn(),
  setMessageTone: jest.fn(),
  getRingtone: jest.fn(),
  setRingtone: jest.fn(),
  getVolume: jest.fn(),
  messageToneUrl: jest.fn(),
  ringtoneUrl: jest.fn(),
}));
import * as sounds from '@/utils/sounds';

// ---- toast ----
jest.mock('@/utils/toast', () => ({ __esModule: true, toast: { ok: jest.fn() } }));
import { toast } from '@/utils/toast';

// ---- SUT ----
// Use a relative path to avoid alias issues; adjust if your file lives elsewhere.
import ProfileSounds from '../ProfileSounds';

// ---- Mock global Audio to inspect behavior ----
const playSpy = jest.fn();
let audioInstances = [];
class FakeAudio {
  constructor(url) {
    this.src = url;
    this.volume = 0;
    this.play = playSpy;
    audioInstances.push(this);
  }
}
beforeAll(() => {
  // @ts-ignore
  global.Audio = FakeAudio;
});
beforeEach(() => {
  jest.clearAllMocks();
  audioInstances = [];
});

// ---- Helpers / fixtures ----
const FREE_MSG = [
  { label: 'Default', value: 'Default.mp3' },
  { label: 'Ping', value: 'Ping.mp3' },
];
const FREE_RING = [
  { label: 'Classic', value: 'Classic.mp3' },
  { label: 'Digital', value: 'Digital.mp3' },
];
const PREM_MSG = [...FREE_MSG, { label: 'Aurora', value: 'Aurora.mp3', premium: true }];
const PREM_RING = [...FREE_RING, { label: 'Nebula', value: 'Nebula.mp3', premium: true }];

describe('ProfileSounds', () => {
  test('initial render uses getters and shows options by plan', () => {
    sounds.getMessageTone.mockReturnValue('Default.mp3');
    sounds.getRingtone.mockReturnValue('Classic.mp3');
    sounds.listMessageTones.mockImplementation((plan) => (plan === 'PREMIUM' ? PREM_MSG : FREE_MSG));
    sounds.listRingtones.mockImplementation((plan) => (plan === 'PREMIUM' ? PREM_RING : FREE_RING));

    render(<ProfileSounds currentUser={{ plan: 'FREE' }} />);

    expect(screen.getByTestId('select-Message tone')).toHaveAttribute('data-value', 'Default.mp3');
    expect(screen.getByTestId('select-Ringtone')).toHaveAttribute('data-value', 'Classic.mp3');

    // Free options rendered (buttons)
    expect(screen.getByTestId('opt-Message tone-Default.mp3')).toBeInTheDocument();
    expect(screen.getByTestId('opt-Ringtone-Classic.mp3')).toBeInTheDocument();
  });

  test('FREE plan: stored message tone not allowed -> falls back to first free option and persists', () => {
    // Stored is premium-only value
    sounds.getMessageTone.mockReturnValue('Aurora.mp3');
    sounds.getRingtone.mockReturnValue('Classic.mp3');
    sounds.listMessageTones.mockReturnValue(FREE_MSG); // no Aurora
    sounds.listRingtones.mockReturnValue(FREE_RING);

    render(<ProfileSounds currentUser={{ plan: 'FREE' }} />);

    expect(sounds.setMessageTone).toHaveBeenCalledWith('Default.mp3');
    expect(screen.getByTestId('select-Message tone')).toHaveAttribute('data-value', 'Default.mp3');
  });

  test('FREE plan: stored ringtone not allowed -> falls back & persists', () => {
    sounds.getMessageTone.mockReturnValue('Default.mp3');
    sounds.getRingtone.mockReturnValue('Nebula.mp3'); // not allowed in FREE
    sounds.listMessageTones.mockReturnValue(FREE_MSG);
    sounds.listRingtones.mockReturnValue(FREE_RING);

    render(<ProfileSounds currentUser={{ plan: 'FREE' }} />);

    expect(sounds.setRingtone).toHaveBeenCalledWith('Classic.mp3');
    expect(screen.getByTestId('select-Ringtone')).toHaveAttribute('data-value', 'Classic.mp3');
  });

  test('changing selects persists and toasts', () => {
    sounds.getMessageTone.mockReturnValue('Default.mp3');
    sounds.getRingtone.mockReturnValue('Classic.mp3');
    sounds.listMessageTones.mockReturnValue(FREE_MSG);
    sounds.listRingtones.mockReturnValue(FREE_RING);

    render(<ProfileSounds currentUser={{ plan: 'FREE' }} />);

    // Change message tone
    fireEvent.click(screen.getByTestId('opt-Message tone-Ping.mp3'));
    expect(sounds.setMessageTone).toHaveBeenCalledWith('Ping.mp3');
    expect(toast.ok).toHaveBeenCalledWith('Message tone saved.');
    expect(screen.getByTestId('select-Message tone')).toHaveAttribute('data-value', 'Ping.mp3');

    // Change ringtone
    fireEvent.click(screen.getByTestId('opt-Ringtone-Digital.mp3'));
    expect(sounds.setRingtone).toHaveBeenCalledWith('Digital.mp3');
    expect(toast.ok).toHaveBeenCalledWith('Ringtone saved.');
    expect(screen.getByTestId('select-Ringtone')).toHaveAttribute('data-value', 'Digital.mp3');
  });

  test('Preview (message tone): builds URL from selection, uses getVolume, clamps, and plays', () => {
  sounds.getMessageTone.mockReturnValue('Default.mp3');
  sounds.getRingtone.mockReturnValue('Classic.mp3');
  sounds.listMessageTones.mockReturnValue(FREE_MSG);
  sounds.listRingtones.mockReturnValue(FREE_RING);
  sounds.messageToneUrl.mockReturnValue('/tones/default.mp3');
  sounds.getVolume.mockReturnValue(2); // should clamp to 1

  render(<ProfileSounds currentUser={{ plan: 'FREE' }} />);

  // Click the first Preview (message tone section)
  const previews = screen.getAllByText(/Preview/i);
  fireEvent.click(previews[0]);

  expect(sounds.messageToneUrl).toHaveBeenCalledWith('Default.mp3');
  expect(audioInstances[0].src).toBe('/tones/default.mp3');
  expect(audioInstances[0].volume).toBe(1);
  expect(playSpy).toHaveBeenCalled();
});

  test('Preview (ringtone): similar behavior and calls ringtoneUrl', () => {
    sounds.getMessageTone.mockReturnValue('Default.mp3');
    sounds.getRingtone.mockReturnValue('Classic.mp3');
    sounds.listMessageTones.mockReturnValue(FREE_MSG);
    sounds.listRingtones.mockReturnValue(FREE_RING);
    sounds.ringtoneUrl.mockReturnValue('/ring/classic.mp3');
    sounds.getVolume.mockReturnValue(0.5);

    render(<ProfileSounds currentUser={{ plan: 'FREE' }} />);

    const buttons = screen.getAllByText(/Preview/i);
    fireEvent.click(buttons[1]); // ringtone Preview

    expect(sounds.ringtoneUrl).toHaveBeenCalledWith('Classic.mp3');
    expect(audioInstances[0].src).toBe('/ring/classic.mp3');
    expect(audioInstances[0].volume).toBe(0.5);
    expect(playSpy).toHaveBeenCalled();
  });

  test('PREMIUM plan exposes premium options; no fallback needed if stored values are premium', () => {
    sounds.getMessageTone.mockReturnValue('Aurora.mp3');
    sounds.getRingtone.mockReturnValue('Nebula.mp3');
    sounds.listMessageTones.mockImplementation((plan) => (plan === 'PREMIUM' ? PREM_MSG : FREE_MSG));
    sounds.listRingtones.mockImplementation((plan) => (plan === 'PREMIUM' ? PREM_RING : FREE_RING));

    render(<ProfileSounds currentUser={{ plan: 'PREMIUM' }} />);

    expect(screen.getByTestId('select-Message tone')).toHaveAttribute('data-value', 'Aurora.mp3');
    expect(screen.getByTestId('select-Ringtone')).toHaveAttribute('data-value', 'Nebula.mp3');
    expect(sounds.setMessageTone).not.toHaveBeenCalled();
    expect(sounds.setRingtone).not.toHaveBeenCalled();
  });
});
