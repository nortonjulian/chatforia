import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileUploader from '@/components/FileUploader';
import axiosClient from '@/api/axiosClient';
import { toast } from '@/utils/toast';

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

jest.mock('@/utils/toast', () => ({
  toast: {
    ok: jest.fn(),
    err: jest.fn(),
  },
}));

class MockXHR {
  open = jest.fn();
  setRequestHeader = jest.fn();
  upload = {};
  status = 200;

  send = jest.fn(() => {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 50,
      total: 100,
    });

    setTimeout(() => {
      this.onload?.();
    }, 0);
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  global.XMLHttpRequest = jest.fn(() => new MockXHR());

  Object.defineProperty(window, 'crypto', {
    value: {
      subtle: {
        digest: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
      },
    },
    configurable: true,
  });
});

function makeFile(name = 'pic.png', type = 'image/png', content = 'x') {
  return new File([content], name, { type });
}

describe('FileUploader', () => {
  test('successful upload creates intent, uploads file, completes upload, and calls onUploaded', async () => {
    const onStart = jest.fn();
    const onProgress = jest.fn();
    const onUploaded = jest.fn();

    axiosClient.post
      .mockResolvedValueOnce({
        data: {
          uploadUrl: 'https://uploads.example.com/pic.png',
          key: 'uploads/pic.png',
          publicUrl: 'https://cdn.example.com/pic.png',
        },
      })
      .mockResolvedValueOnce({
        data: {
          file: {
            key: 'uploads/pic.png',
            name: 'pic.png',
            contentType: 'image/png',
            size: 1,
          },
        },
      });

    const { container } = render(
      <FileUploader
        button={<button type="button">Choose file</button>}
        onStart={onStart}
        onProgress={onProgress}
        onUploaded={onUploaded}
      />
    );

    const file = makeFile();
    const fileInput = container.querySelector('input[type="file"]');

    fireEvent.change(fileInput, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });

    expect(onStart).toHaveBeenCalledWith(file);

    expect(axiosClient.post).toHaveBeenNthCalledWith(
      1,
      '/uploads/intent',
      expect.objectContaining({
        name: 'pic.png',
        size: file.size,
        mimeType: 'image/png',
        sha256: null,
      }),
      {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      }
    );

    expect(global.XMLHttpRequest).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(50, file);

    expect(axiosClient.post).toHaveBeenNthCalledWith(
      2,
      '/uploads/complete',
      expect.objectContaining({
        key: 'uploads/pic.png',
        name: 'pic.png',
        mimeType: 'image/png',
        size: file.size,
        sha256: null,
      }),
      {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      }
    );

    expect(onUploaded).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'uploads/pic.png',
        url: 'https://cdn.example.com/pic.png',
        name: 'pic.png',
        mimeType: 'image/png',
        contentType: 'image/png',
        size: file.size,
      })
    );

    expect(toast.ok).toHaveBeenCalledWith('File uploaded.');
  });

  test('failed intent calls onError and toast.err', async () => {
    const onError = jest.fn();

    axiosClient.post.mockRejectedValueOnce(new Error('Upload blocked'));

    const { container } = render(
      <FileUploader button={<button type="button">Choose file</button>} onError={onError} />
    );

    const fileInput = container.querySelector('input[type="file"]');

    fireEvent.change(fileInput, {
      target: { files: [makeFile()] },
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Upload blocked');
    });

    expect(toast.err).toHaveBeenCalledWith('Upload blocked');
    expect(axiosClient.post).toHaveBeenCalledTimes(1);
  });

  test('no action when user cancels file selection', () => {
    const { container } = render(
      <FileUploader button={<button type="button">Choose file</button>} onUploaded={jest.fn()} />
    );

    const fileInput = container.querySelector('input[type="file"]');

    fireEvent.change(fileInput, {
      target: { files: [] },
    });

    expect(axiosClient.post).not.toHaveBeenCalled();
  });
});