import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import axiosClient from '../../../api/axiosClient';
import VoiceNoteTranscript from '../VoiceNoteTranscript';

jest.mock('../../../api/axiosClient', () => ({ __esModule: true, default: { post: jest.fn() } }));
const user = { id: 65, a11yVoiceNoteSTT: true };
const msg = { id: 10, revision: 1 };
const result = text => ({ data: { transcript: { segments: [{ text }] } } });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => axiosClient.post.mockReset());

test('uses authenticated API and renders the returned spoken text', async () => {
  axiosClient.post.mockResolvedValue(result('The words I recorded.'));
  render(<VoiceNoteTranscript msg={msg} currentUser={user} />);
  expect(screen.getByRole('status')).toHaveTextContent('Transcribing…');
  expect(await screen.findByLabelText('Voice-note transcript')).toHaveTextContent('The words I recorded.');
  expect(axiosClient.post).toHaveBeenCalledWith('/media/10/transcribe', {}, expect.objectContaining({ timeout: 90000, signal: expect.anything() }));
});
test('OFF makes no request and shows no transcription placeholder', () => {
  render(<VoiceNoteTranscript msg={msg} currentUser={{ ...user, a11yVoiceNoteSTT: false }} />);
  expect(axiosClient.post).not.toHaveBeenCalled(); expect(screen.queryByRole('status')).toBeNull();
});
test('failed provider stops the spinner and an explicit retry can succeed', async () => {
  axiosClient.post.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(result('Recovered'));
  render(<VoiceNoteTranscript msg={msg} currentUser={user} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry transcription' }));
  expect(await screen.findByLabelText('Voice-note transcript')).toHaveTextContent('Recovered');
  expect(axiosClient.post).toHaveBeenCalledTimes(2);
});
test('empty final transcript reports silence rather than an endless spinner', async () => {
  axiosClient.post.mockResolvedValue({ data: { transcript: { segments: [] } } });
  render(<VoiceNoteTranscript msg={msg} currentUser={user} />);
  expect(await screen.findByLabelText('Voice-note transcript')).toHaveTextContent('No speech detected.');
});
test('disabling the preference hides existing text immediately', async () => {
  axiosClient.post.mockResolvedValue(result('Sensitive words'));
  const { rerender } = render(<VoiceNoteTranscript msg={msg} currentUser={user} />);
  await screen.findByText('Sensitive words');
  rerender(<VoiceNoteTranscript msg={msg} currentUser={{ ...user, a11yVoiceNoteSTT: false }} />);
  expect(screen.queryByText('Sensitive words')).toBeNull();
});
test('account changes reject a late response from the previous account', async () => {
  const old = deferred(); const next = deferred(); axiosClient.post.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const { rerender } = render(<VoiceNoteTranscript msg={msg} currentUser={user} />);
  const signal = axiosClient.post.mock.calls[0][2].signal;
  rerender(<VoiceNoteTranscript msg={msg} currentUser={{ ...user, id: 68 }} />);
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(result('Previous account secret')));
  expect(screen.queryByText('Previous account secret')).toBeNull();
  await act(async () => next.resolve(result('Current account text')));
  expect(await screen.findByText('Current account text')).toBeInTheDocument();
});
test('a message revision hides the prior transcript and ignores its late response', async () => {
  const old = deferred(); axiosClient.post.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('New version'));
  const { rerender } = render(<VoiceNoteTranscript msg={msg} currentUser={user} />);
  rerender(<VoiceNoteTranscript msg={{ ...msg, revision: 2 }} currentUser={user} />);
  await screen.findByText('New version');
  await act(async () => old.resolve(result('Old version')));
  expect(screen.queryByText('Old version')).toBeNull();
});
test('missing transcript is a retryable failure, never a fake success', async () => {
  axiosClient.post.mockResolvedValue({ data: { ok: true } });
  render(<VoiceNoteTranscript msg={msg} currentUser={user} />);
  await screen.findByRole('button', { name: 'Retry transcription' });
  expect(screen.queryByLabelText('Voice-note transcript')).toBeNull();
});
