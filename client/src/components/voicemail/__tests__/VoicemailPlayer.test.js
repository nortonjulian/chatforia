import { fetchVoicemailAudio } from '@/api/voicemailApi.js';
jest.mock('@/api/voicemailApi.js', () => ({ fetchVoicemailAudio: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  URL.createObjectURL = jest.fn(() => 'blob:authorized-audio');
  URL.revokeObjectURL = jest.fn();
  fetchVoicemailAudio.mockResolvedValue(new Blob(['audio'], { type: 'audio/mpeg' }));
});
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import VoicemailPlayer from '../VoicemailPlayer.jsx';

// Mock i18next translations so we get stable strings
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts && typeof opts.count !== 'undefined') {
        return `${key}(${opts.count})`;
      }
      return key;
    },
  }),
}));

describe('VoicemailPlayer', () => {
  test('returns null when voicemail prop is missing', () => {
    const { container } = render(<VoicemailPlayer voicemail={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders basic info and audio player', async () => {
    const voicemail = {
      id: 'vm-owner-1',
      fromNumber: '+15551234567',
      toNumber: '+15557654321',
      audioUrl: 'https://example.com/vm.mp3',
      durationSec: 42,
      createdAt: '2024-01-01T12:34:56.000Z',
      transcript: '',
      transcriptStatus: 'PENDING',
    };

    render(<VoicemailPlayer voicemail={voicemail} />);

    // "From" line
    expect(screen.getByText('voicemail.from')).toBeInTheDocument();
    expect(screen.getByText('+15551234567')).toBeInTheDocument();

    // "To" line
    expect(screen.getByText('voicemail.to')).toBeInTheDocument();
    expect(screen.getByText('+15557654321')).toBeInTheDocument();

    // Duration is rendered via t('voicemail.durationSeconds', { count })
    expect(
      screen.getByText('voicemail.durationSeconds(42)', { exact: false })
    ).toBeInTheDocument();

    // Audio player exists with correct src + aria-label
    const audio = screen.getByLabelText('voicemail.audioAria');
    expect(audio).toBeInTheDocument();
    expect(audio.tagName.toLowerCase()).toBe('audio');
    await waitFor(() => expect(audio).toHaveAttribute('src', 'blob:authorized-audio'));
    expect(fetchVoicemailAudio).toHaveBeenCalledWith('vm-owner-1', expect.anything());
    expect(audio).not.toHaveAttribute('src', voicemail.audioUrl);
  });

  test('uses unknown/yourNumber fallbacks when numbers are missing', () => {
    const voicemail = {
      fromNumber: null,
      toNumber: '',
      audioUrl: 'https://example.com/vm.mp3',
      durationSec: null,
      createdAt: null,
      transcript: '',
      transcriptStatus: 'PENDING',
    };

    render(<VoicemailPlayer voicemail={voicemail} />);

    // From fallback
    expect(screen.getByText('voicemail.unknownCaller')).toBeInTheDocument();
    // To fallback
    expect(screen.getByText('voicemail.yourNumber')).toBeInTheDocument();
  });

  test('shows transcript when status is COMPLETE and transcript has content', () => {
    const voicemail = {
      id: 'vm-owner-1',
      fromNumber: '+15551234567',
      toNumber: '+15557654321',
      audioUrl: 'https://example.com/vm.mp3',
      durationSec: 10,
      createdAt: '2024-01-01T00:00:00.000Z',
      transcript: '  Hello world  ',
      transcriptStatus: 'COMPLETE',
    };

    render(<VoicemailPlayer voicemail={voicemail} />);

    // Heading
    expect(
      screen.getByText('voicemail.transcriptHeading')
    ).toBeInTheDocument();

    // Trimmed transcript body
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  test('shows pending message when transcriptStatus is PENDING', () => {
    const voicemail = {
      id: 'vm-owner-1',
      fromNumber: '+15551234567',
      toNumber: '+15557654321',
      audioUrl: 'https://example.com/vm.mp3',
      durationSec: 10,
      createdAt: '2024-01-01T00:00:00.000Z',
      transcript: '',
      transcriptStatus: 'PENDING',
    };

    render(<VoicemailPlayer voicemail={voicemail} />);

    expect(
      screen.getByText('voicemail.transcriptPending')
    ).toBeInTheDocument();
  });

  test('shows failed message when transcriptStatus is FAILED', () => {
    const voicemail = {
      id: 'vm-owner-1',
      fromNumber: '+15551234567',
      toNumber: '+15557654321',
      audioUrl: 'https://example.com/vm.mp3',
      durationSec: 10,
      createdAt: '2024-01-01T00:00:00.000Z',
      transcript: '',
      transcriptStatus: 'FAILED',
    };

    render(<VoicemailPlayer voicemail={voicemail} />);

    expect(
      screen.getByText('voicemail.transcriptFailed')
    ).toBeInTheDocument();
  });
});

test('failed audio remains visible and explicit retry recovers', async () => {
  fetchVoicemailAudio.mockRejectedValueOnce(new Error('offline'));
  render(<VoicemailPlayer voicemail={{id:'vm-retry'}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load');
  fireEvent.click(screen.getByRole('button', {name:'Retry audio'}));
  await waitFor(() => expect(screen.getByLabelText('voicemail.audioAria')).toHaveAttribute('src','blob:authorized-audio'));
});
test('switching messages rejects stale media and releases the previous URL', async () => {
  let resolveOld;
  fetchVoicemailAudio.mockImplementationOnce(() => new Promise(resolve => { resolveOld=resolve; }));
  const view=render(<VoicemailPlayer voicemail={{id:'old'}} />);
  view.rerender(<VoicemailPlayer voicemail={{id:'new'}} />);
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  resolveOld(new Blob(['old'],{type:'audio/mpeg'}));
  await waitFor(() => expect(fetchVoicemailAudio).toHaveBeenCalledTimes(2));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authorized-audio');
});
