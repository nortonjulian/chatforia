import { render, screen, waitFor, act } from '@testing-library/react';

// Mock TranscriptBubble to inspect props (use RELATIVE path, no "@")
jest.mock('../../components/TranscriptBubble', () => ({
  __esModule: true,
  default: ({ segments }) => (
    <div data-testid="transcript-bubble">{JSON.stringify(segments || null)}</div>
  ),
}));

// SUT: AudioMessage lives at src/features/messages/AudioMessage.js(x)
import AudioMessage from '../../messages/AudioMessage';

describe('AudioMessage', () => {
  let originalFetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('STT enabled: posts transcribe, fetches transcript, renders TranscriptBubble', async () => {
    const fetchMock = jest.fn()
      // POST /media/:id/transcribe
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      // GET /transcripts/:id
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transcript: { segments: [{ t: 0, text: 'hello' }] } }),
      });

    global.fetch = fetchMock;

    render(
      <AudioMessage
        msg={{ id: 'm1', audioUrl: '/audio/a1.mp3' }}
        currentUser={{ a11yVoiceNoteSTT: true }}
      />
    );

    // Audio element and initial placeholder
    const audioEls = document.getElementsByTagName('audio');
    expect(audioEls).toHaveLength(1);
    expect(audioEls[0]).toHaveAttribute('src', '/audio/a1.mp3');

    // While loading, placeholder shows
    expect(screen.getByText(/Transcribing…/i)).toBeInTheDocument();

    // Calls made
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/media/m1/transcribe',
        expect.objectContaining({ method: 'POST' })
      );
      expect(fetchMock).toHaveBeenCalledWith('/transcripts/m1');
    });

    // TranscriptBubble rendered with segments
    expect(screen.getByTestId('transcript-bubble')).toHaveTextContent(
      JSON.stringify([{ t: 0, text: 'hello' }])
    );
    // Placeholder disappears
    expect(screen.queryByText(/Transcribing…/i)).toBeNull();
  });

  test('STT disabled: does not call fetch; audio + placeholder visible', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    render(
      <AudioMessage
        msg={{ id: 'm2', audioUrl: '/audio/a2.mp3' }}
        currentUser={{ a11yVoiceNoteSTT: false }}
      />
    );

    const audioEls = document.getElementsByTagName('audio');
    expect(audioEls.length).toBe(1);
    expect(audioEls[0]).toHaveAttribute('src', '/audio/a2.mp3');

    expect(screen.getByText(/Transcribing…/i)).toBeInTheDocument();
    // No network calls
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('Transcript fetch not ok -> keeps placeholder (no TranscriptBubble)', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // POST
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) }); // GET not ok

    global.fetch = fetchMock;

    render(
      <AudioMessage
        msg={{ id: 'm3', audioUrl: '/audio/a3.mp3' }}
        currentUser={{ a11yVoiceNoteSTT: true }}
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/transcripts/m3'));
    // Still showing placeholder
    expect(screen.getByText(/Transcribing…/i)).toBeInTheDocument();
    expect(screen.queryByTestId('transcript-bubble')).toBeNull();
  });

  test('cleanup guard: no state update after unmount', async () => {
    let resolvePost;
    let resolveGet;

    const fetchMock = jest.fn()
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolvePost = () => res({ ok: true, json: async () => ({}) });
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveGet = () => res({
              ok: true,
              json: async () => ({ transcript: { segments: [{ text: 'delayed' }] } }),
            });
          })
      );

    global.fetch = fetchMock;

    const { unmount } = render(
      <AudioMessage
        msg={{ id: 'm4', audioUrl: '/audio/a4.mp3' }}
        currentUser={{ a11yVoiceNoteSTT: true }}
      />
    );

    // Resolve POST, then unmount before GET resolves
    await act(async () => resolvePost());
    unmount();

    // Resolve GET after unmount; should not throw/warn or render
    await act(async () => resolveGet());
  });
});
