import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import BottomComposer from '@/components/BottomComposer';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

jest.mock('@/components/MicButton.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/StickerPicker.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/FileUploader.jsx', () => ({
  __esModule: true,
  default: ({ onUploaded }) => (
    <button
      type="button"
      onClick={() => onUploaded(
        {
          key: 'uploads/u1/test-video.mp4',
          name: 'test-video.mp4',
          mimeType: 'video/mp4',
          contentType: 'video/mp4',
          size: 100,
        },
        new File(['video-data'], 'test-video.mp4', {
          type: 'video/mp4',
        })
      )}
    >
      Mock media upload
    </button>
  ),
}));

let nextBlob = 0;

beforeEach(() => {
  nextBlob = 0;

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: jest.fn(() => `blob:test-${++nextBlob}`),
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });
});

function renderComposer(onSend = jest.fn().mockResolvedValue(undefined)) {
  const view = render(
    <MantineProvider>
      <BottomComposer
        value=""
        onChange={jest.fn()}
        onSend={onSend}
        showGif={false}
        showEmoji={false}
        showMic={false}
      />
    </MantineProvider>
  );

  return { ...view, onSend };
}

test('video upload creates a local preview', () => {
  const { container } = renderComposer();

  fireEvent.click(screen.getByText('Mock media upload'));

  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(container.querySelector('video')?.src).toContain('blob:test-1');
});

test('removing a video revokes its local preview URL', async () => {
  renderComposer();

  fireEvent.click(screen.getByText('Mock media upload'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Remove selected attachment',
  }));

  await waitFor(() => {
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
  });
});

test('sending excludes preview URL from message metadata', async () => {
  const { onSend } = renderComposer();

  fireEvent.click(screen.getByText('Mock media upload'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => {
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  const payload = onSend.mock.calls[0][0];

  expect(payload.attachments).toHaveLength(1);
  expect(payload.attachments[0].key).toBe('uploads/u1/test-video.mp4');
  expect(payload.attachments[0]).not.toHaveProperty('previewUrl');
});

test('failed sends preserve the selected attachment', async () => {
  let rejectSend;

  const onSend = jest.fn(() => new Promise((_resolve, reject) => {
    rejectSend = reject;
  }));

  const { container } = renderComposer(onSend);

  fireEvent.click(screen.getByText('Mock media upload'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(onSend).toHaveBeenCalledTimes(1);

  await act(async () => {
    rejectSend(new Error('Network failure'));
    try {
      await onSend.mock.results[0].value;
    } catch {
      // Expected send failure
    }
  });

  expect(container.querySelector('video')).not.toBeNull();
});


test('a false send result retains the attachment', async () => {
  const onSend = jest.fn().mockResolvedValue(false);
  const { container } = renderComposer(onSend);

  fireEvent.click(screen.getByText('Mock media upload'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Message could not be sent'
    );
  });

  expect(container.querySelector('video')).not.toBeNull();
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
});

test('repeated Send clicks do not duplicate an in-flight message', async () => {
  let completeSend;
  const onSend = jest.fn(() => new Promise((resolve) => {
    completeSend = resolve;
  }));

  renderComposer(onSend);
  fireEvent.click(screen.getByText('Mock media upload'));

  const sendButton = screen.getByRole('button', { name: 'Send' });
  fireEvent.click(sendButton);
  fireEvent.click(sendButton);

  expect(onSend).toHaveBeenCalledTimes(1);

  await act(async () => {
    completeSend(true);
  });

  await waitFor(() => {
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
  });
});
