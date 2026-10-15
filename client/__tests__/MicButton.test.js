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

const perfNow = jest.spyOn(performance, 'now');

let xhrAutoComplete = true;
let lastXhr = null;

class MockXMLHttpRequest {
  constructor() {
    this.method = null;
    this.url = null;
    this.async = true;
    this.headers = {};
    this.status = 0;
    this.upload = {};
    this.onload = null;
    this.onerror = null;
    this.sentBody = null;

    lastXhr = this;
  }

  open(method, url, async = true) {
    this.method = method;
    this.url = url;
    this.async = async;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    this.sentBody = body;

    if (xhrAutoComplete) {
      setTimeout(() => {
        this.status = 200;
        this.onload?.();
      }, 0);
    }
  }
}

// Minimal MediaRecorder mock
class MockMediaRecorder {
  constructor(stream, opts = {}) {
    this.stream = stream;
    this.mimeType = opts.mimeType || 'audio/webm';
    this.state = 'inactive';

    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }

  static isTypeSupported(type) {
    return (
      type === 'audio/webm;codecs=opus' ||
      type === 'audio/webm'
    );
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'inactive') return;

    this.state = 'inactive';

    // Real MediaRecorder emits its final data before onstop.
    const chunk = new Blob(
      [new Uint8Array(10)],
      { type: this.mimeType }
    );

    this.ondataavailable?.({ data: chunk });
    this.onstop?.();
  }
}

beforeAll(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: jest.fn(),
    },
  });

  Object.defineProperty(window, 'MediaRecorder', {
    configurable: true,
    value: MockMediaRecorder,
  });

  Object.defineProperty(global, 'MediaRecorder', {
    configurable: true,
    value: MockMediaRecorder,
  });

  Object.defineProperty(window, 'XMLHttpRequest', {
    configurable: true,
    value: MockXMLHttpRequest,
  });

  Object.defineProperty(global, 'XMLHttpRequest', {
    configurable: true,
    value: MockXMLHttpRequest,
  });
});

beforeEach(() => {
  xhrAutoComplete = true;
  lastXhr = null;

  navigator.mediaDevices.getUserMedia.mockResolvedValue({
    getTracks: () => [
      {
        stop: jest.fn(),
      },
    ],
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('<MicButton />', () => {
  test('records, stops, uploads through intent/complete, and calls onUploaded with duration', async () => {
    const axiosClient =
      (await import('@/api/axiosClient')).default;

    const { toast } =
      await import('@/utils/toast');

    let t = 1000;
    perfNow.mockImplementation(() => t);

    // 1) POST /uploads/intent
    axiosClient.post.mockResolvedValueOnce({
      data: {
        uploadUrl: 'https://storage.example.com/voice-upload',
        key: 'user/42/voice-123.webm',
        publicUrl: 'https://cdn.example.com/u/voice-123.webm',
      },
    });

    // 2) POST /uploads/complete
    axiosClient.post.mockResolvedValueOnce({
      data: {
        file: {
          key: 'user/42/voice-123.webm',
          url: 'https://cdn.example.com/u/voice-123.webm',
          name: 'voice-123.webm',
          contentType: 'audio/webm;codecs=opus',
          size: 10,
          durationSec: null,
          thumbUrl: null,
        },
      },
    });

    const onUploaded = jest.fn();

    render(
      <MicButton
        chatRoomId={42}
        onUploaded={onUploaded}
      />
    );

    const recordBtn = await screen.findByRole(
      'button',
      { name: /record voice note/i }
    );

    await userEvent.click(recordBtn);

    const stopBtn = await screen.findByRole(
      'button',
      { name: /stop recording/i }
    );

    expect(stopBtn).toBeInTheDocument();

    // Simulate ~3.2 seconds elapsed.
    t = 4200;

    await userEvent.click(stopBtn);

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(2);
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });

    // Intent request
    expect(axiosClient.post.mock.calls[0][0])
      .toBe('/uploads/intent');

    expect(axiosClient.post.mock.calls[0][1])
      .toMatchObject({
        size: 10,
        mimeType: 'audio/webm;codecs=opus',
      });

    expect(
      axiosClient.post.mock.calls[0][1].name
    ).toMatch(/^voice-\d+\.webm$/);

    // Direct storage PUT
    expect(lastXhr).not.toBeNull();
    expect(lastXhr.method).toBe('PUT');

    expect(lastXhr.url).toBe(
      'https://storage.example.com/voice-upload'
    );

    expect(lastXhr.headers['Content-Type'])
      .toBe('audio/webm;codecs=opus');

    expect(lastXhr.sentBody).toBeInstanceOf(File);

    // Complete request
    expect(axiosClient.post.mock.calls[1][0])
      .toBe('/uploads/complete');

    expect(axiosClient.post.mock.calls[1][1])
      .toMatchObject({
        key: 'user/42/voice-123.webm',
        size: 10,
        mimeType: 'audio/webm;codecs=opus',
      });

    // Canonical attachment returned to composer
    const meta = onUploaded.mock.calls[0][0];

    expect(meta).toMatchObject({
      key: 'user/42/voice-123.webm',
      url: 'https://cdn.example.com/u/voice-123.webm',
      mimeType: 'audio/webm;codecs=opus',
      contentType: 'audio/webm;codecs=opus',
      size: 10,
      durationSec: 3,
      kind: 'AUDIO',
    });

    expect(toast.err).not.toHaveBeenCalled();
    expect(toast.ok).toHaveBeenCalledWith(
      'Voice note added.'
    );

    // Returns to idle after successful upload
    expect(
      await screen.findByRole(
        'button',
        { name: /record voice note/i }
      )
    ).toBeInTheDocument();
  });

  test('handles microphone permission error gracefully', async () => {
    const axiosClient =
      (await import('@/api/axiosClient')).default;

    const { toast } =
      await import('@/utils/toast');

    navigator.mediaDevices.getUserMedia
      .mockRejectedValueOnce(
        new Error('Permission denied')
      );

    render(
      <MicButton
        chatRoomId={1}
        onUploaded={jest.fn()}
      />
    );

    const recordBtn = await screen.findByRole(
      'button',
      { name: /record voice note/i }
    );

    await userEvent.click(recordBtn);

    expect(
      await screen.findByRole(
        'button',
        { name: /record voice note/i }
      )
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(toast.err).toHaveBeenCalledWith(
        'Microphone permission is required.'
      );
    });

    expect(axiosClient.post)
      .not.toHaveBeenCalled();

    expect(lastXhr).toBeNull();
  });

  test('busy state disables stop control while voice note uploads', async () => {
    const axiosClient =
      (await import('@/api/axiosClient')).default;

    let t = 1000;
    perfNow.mockImplementation(() => t);

    xhrAutoComplete = false;

    axiosClient.post.mockResolvedValueOnce({
      data: {
        uploadUrl: 'https://storage.example.com/pending-voice',
        key: 'user/5/pending.webm',
        publicUrl: 'https://cdn.example.com/pending.webm',
      },
    });

    axiosClient.post.mockResolvedValueOnce({
      data: {
        file: {
          key: 'user/5/pending.webm',
          url: 'https://cdn.example.com/pending.webm',
          name: 'pending.webm',
          contentType: 'audio/webm;codecs=opus',
          size: 10,
        },
      },
    });

    render(
      <MicButton
        chatRoomId={5}
        onUploaded={jest.fn()}
      />
    );

    const recordBtn = await screen.findByRole(
      'button',
      { name: /record voice note/i }
    );

    await userEvent.click(recordBtn);

    const stopBtn = await screen.findByRole(
      'button',
      { name: /stop recording/i }
    );

    t = 2000;

    await userEvent.click(stopBtn);

    // Wait until React has committed the busy state.
    await waitFor(() => {
      expect(
        screen.getByRole(
          'button',
          { name: /saving voice note/i }
        )
      ).toBeDisabled();
    });

    expect(lastXhr).not.toBeNull();
    expect(lastXhr.url).toBe(
      'https://storage.example.com/pending-voice'
    );

    // Finish direct storage upload.
    await act(async () => {
      lastXhr.status = 200;
      lastXhr.onload?.();
    });

    await waitFor(() => {
      expect(
        screen.getByRole(
          'button',
          { name: /record voice note/i }
        )
      ).toBeInTheDocument();
    });

    expect(axiosClient.post)
      .toHaveBeenCalledTimes(2);
  });
});
