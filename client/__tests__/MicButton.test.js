/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MicButton from '@/components/MicButton.jsx';

// ---- Mocks ----
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock('@/utils/toast', () => ({
  toast: {
    err: jest.fn(),
    ok: jest.fn(),
    info: jest.fn(),
  },
}));

// Provide a stable performance.now() for duration calculation
const perfNow = jest.spyOn(performance, 'now');

// Minimal MediaRecorder mock
class MockMediaRecorder {
  constructor(stream, opts = {}) {
    this.stream = stream;
    this.mimeType = opts.mimeType || 'audio/webm';
    this.state = 'inactive';
    this._interval = null;
    this.ondataavailable = null;
    this.onstop = null;
  }
  start(timesliceMs = 100) {
    this.state = 'recording';
    // simulate chunking
    this._interval = setInterval(() => {
      if (this.ondataavailable) {
        // give a 10-byte blob per event
        const chunk = new Blob([new Uint8Array(10)], { type: this.mimeType });
        this.ondataavailable({ data: chunk });
      }
    }, timesliceMs);
  }
  stop() {
    this.state = 'inactive';
    if (this._interval) clearInterval(this._interval);
    if (this.onstop) this.onstop();
  }
}

// Attach to window for the component to see
beforeAll(() => {
  // navigator.mediaDevices.getUserMedia mock
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue({
        getTracks: () => [{ stop: jest.fn() }],
      }),
    },
  });

  // MediaRecorder mock
  Object.defineProperty(window, 'MediaRecorder', {
    configurable: true,
    value: MockMediaRecorder,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('<MicButton />', () => {
  test('records, stops, uploads, and calls onUploaded with duration', async () => {
    const axiosClient = (await import('@/api/axiosClient')).default;
    const { toast } = await import('@/utils/toast');

    // mock performance.now to simulate ~3.2s duration → rounds to 3
    let t = 1000;
    perfNow.mockImplementation(() => t);

    // axios resolves with a URL & contentType
    axiosClient.post.mockResolvedValueOnce({
      data: { url: 'https://cdn.example.com/u/voice-123.webm', contentType: 'audio/webm' },
    });

    const onUploaded = jest.fn();

    render(<MicButton chatRoomId={42} onUploaded={onUploaded} />);

    // Click "Record voice note"
    const recordBtn = await screen.findByRole('button', { name: /record voice note/i });
    await userEvent.click(recordBtn);

    // Ensure "Stop" button is shown now
    const stopBtn = await screen.findByRole('button', { name: /stop/i });
    expect(stopBtn).toBeInTheDocument();

    // Advance performance clock to simulate ~3.2s recording
    t = 4200; // start ~1000 → stop ~4200 → ~3.2s => 3s
    await userEvent.click(stopBtn);

    // NOTE:
    // We *don't* assert disabled state here because the upload promise
    // is resolved immediately and userEvent.click awaits the whole cycle.
    // The "busy disables controls" behavior is covered in the dedicated test
    // below ("busy state disables controls during upload").

    // Wait for upload to finish and callback to fire
    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(1);
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });

    // Validate payload
    const fd = axiosClient.post.mock.calls[0][1];
    // We can’t directly inspect FormData contents easily; assert endpoint + headers
    expect(axiosClient.post.mock.calls[0][0]).toBe('/files/upload');
    expect(axiosClient.post.mock.calls[0][2]).toMatchObject({
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    // Validate callback meta
    const meta = onUploaded.mock.calls[0][0];
    expect(meta).toMatchObject({
      url: 'https://cdn.example.com/u/voice-123.webm',
      contentType: 'audio/webm',
      caption: null,
    });
    // duration should be rounded, min 1
    expect(typeof meta.durationSec).toBe('number');
    expect(meta.durationSec).toBe(3);

    // No error toast
    expect(toast.err).not.toHaveBeenCalled();
  });

  test('handles microphone permission error gracefully', async () => {
    const axiosClient = (await import('@/api/axiosClient')).default;
    const { toast } = await import('@/utils/toast');

    // Fail getUserMedia this time
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error('Permission denied'));

    render(<MicButton chatRoomId={1} onUploaded={jest.fn()} />);

    const recordBtn = await screen.findByRole('button', { name: /record voice note/i });
    await userEvent.click(recordBtn);

    // Should not show Stop; still show Record
    expect(await screen.findByRole('button', { name: /record voice note/i })).toBeInTheDocument();

    // Error toast
    await waitFor(() => expect(toast.err).toHaveBeenCalledWith('Microphone permission is required.'));

    // No upload attempts
    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  test('busy state disables controls during upload', async () => {
    const axiosClient = (await import('@/api/axiosClient')).default;

    // Make axios resolve after a tick to observe disabled state
    let resolveUpload;
    const uploadPromise = new Promise((res) => (resolveUpload = res));
    axiosClient.post.mockImplementationOnce(() => uploadPromise);

    let t = 1000;
    perfNow.mockImplementation(() => t);

    render(<MicButton chatRoomId={5} onUploaded={jest.fn()} />);

    const recordBtn = await screen.findByRole('button', { name: /record voice note/i });
    await userEvent.click(recordBtn);

    const stopBtn = await screen.findByRole('button', { name: /stop/i });
    t = 2000;
    await userEvent.click(stopBtn);

    // Immediately after stop, we should be "busy" → disabled
    expect(stopBtn).toBeDisabled();

    // Finish the upload
    resolveUpload({ data: { url: 'https://cdn.example.com/ok.webm', contentType: 'audio/webm' } });

    await waitFor(() => {
      // After resolve, stopBtn disappears and record button returns
      expect(screen.getByRole('button', { name: /record voice note/i })).toBeInTheDocument();
    });
  });
});
