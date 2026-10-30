import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProtectedMessageAttachment, { isLocalPrivateMedia } from '../ProtectedMessageAttachment';
import axiosClient from '@/api/axiosClient';

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { defaults: { baseURL: 'https://api.chatforia.com' }, get: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('requests a recipient-authorized URL for local private media', async () => {
  axiosClient.get.mockResolvedValue({
    data: { url: '/private-media/file?token=short-lived' },
  });
  render(<ProtectedMessageAttachment viewerId={2} attachment={{
    id: 31, kind: 'IMAGE', mimeType: 'image/jpeg', url: 'media/photo.jpg',
  }} index={0} />);
  await waitFor(() => {
    expect(screen.getByAltText('Attachment')).toHaveAttribute(
      'src', 'https://api.chatforia.com/private-media/file?token=short-lived'
    );
  });
  expect(axiosClient.get).toHaveBeenCalledTimes(1);
  expect(axiosClient.get).toHaveBeenCalledWith(
    '/private-media/message/31',
    expect.objectContaining({ params: { variant: 'file' } })
  );
});

test('an unavailable private media lookup never falls back to the public local path', async () => {
  axiosClient.get.mockRejectedValue(new Error('Forbidden'));
  render(<ProtectedMessageAttachment viewerId={2} attachment={{
    id: 31, kind: 'IMAGE', mimeType: 'image/jpeg', url: 'media/secret.jpg',
  }} index={0} />);
  await waitFor(() => expect(axiosClient.get).toHaveBeenCalled());
  expect(screen.queryByAltText('Attachment')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Media unavailable or loading');
});

test('a prior account media URL disappears before new account authorization resolves', async () => {
  let resolveNew;
  axiosClient.get.mockResolvedValueOnce({
    data: { url: '/private-media/file?token=old-account' },
  }).mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  const att = { id: 31, kind: 'IMAGE', mimeType: 'image/jpeg', url: 'media/private.jpg' };
  const { rerender } = render(<ProtectedMessageAttachment viewerId={2} attachment={att} index={0} />);
  await waitFor(() => expect(screen.getByAltText('Attachment').getAttribute('src')).toContain('old-account'));
  rerender(<ProtectedMessageAttachment viewerId={3} attachment={att} index={0} />);
  expect(screen.queryByAltText('Attachment')).not.toBeInTheDocument();
  await waitFor(() => expect(axiosClient.get).toHaveBeenCalledTimes(2));
  resolveNew({ data: { url: '/private-media/file?token=new-account' } });
  await waitFor(() => expect(screen.getByAltText('Attachment').getAttribute('src')).toContain('new-account'));
});

test('Chatforia CDN message URLs require authorization; unrelated hosts remain external', async () => {
  expect(isLocalPrivateMedia('https://cdn.chatforia.com/uploads/u2/voice.webm')).toBe(true);
  expect(isLocalPrivateMedia('https://cdn.chatforia.com.evil.test/uploads/u2/voice.webm')).toBe(false);
  axiosClient.get.mockResolvedValue({ data: { url: '/private-media/file?token=cdn-capability' } });
  render(<ProtectedMessageAttachment viewerId={2} attachment={{
    id: 55, kind: 'AUDIO', mimeType: 'audio/webm',
    url: 'https://cdn.chatforia.com/uploads/u2/voice.webm'
  }} index={0} />);
  await waitFor(() => expect(document.querySelector('audio')).toHaveAttribute(
    'src', 'https://api.chatforia.com/private-media/file?token=cdn-capability'
  ));
  expect(axiosClient.get).toHaveBeenCalledWith(
    '/private-media/message/55', expect.objectContaining({ params: { variant: 'file' } })
  );
});

test('external media URLs are unchanged and never require private local authorization', () => {
  render(<ProtectedMessageAttachment viewerId={2} attachment={{
    id: 31, kind: 'AUDIO', mimeType: 'audio/mpeg', url: 'https://cdn.example.com/note.mp3',
  }} index={0} />);
  expect(document.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example.com/note.mp3');
  expect(axiosClient.get).not.toHaveBeenCalled();
});

test('canonical R2 upload keys use authorized media delivery, not a public path', async () => {
  expect(isLocalPrivateMedia('uploads/u7/2026/10/26/voice.webm')).toBe(true);
  expect(isLocalPrivateMedia('uploads/u7/../secret.webm')).toBe(false);
  expect(isLocalPrivateMedia('uploads/u7/voice.webm?token=secret')).toBe(false);
  axiosClient.get.mockResolvedValue({ data: { url: '/private-media/file?token=key-capability' } });
  render(<ProtectedMessageAttachment viewerId={7} attachment={{
    id: 88, kind: 'AUDIO', mimeType: 'audio/webm',
    url: 'uploads/u7/2026/10/26/voice.webm',
  }} index={0} />);
  await waitFor(() => expect(document.querySelector('audio')).toHaveAttribute(
    'src', 'https://api.chatforia.com/private-media/file?token=key-capability'
  ));
  expect(axiosClient.get).toHaveBeenCalledWith(
    '/private-media/message/88', expect.objectContaining({ params: { variant: 'file' } })
  );
});


test('renewing a video capability does not reset an already loaded video', async () => {
  jest.useFakeTimers();

  try {
    axiosClient.get
      .mockResolvedValueOnce({
        data: { url: '/private-media/file?token=first' },
      })
      .mockResolvedValueOnce({
        data: { url: '/private-media/file?token=renewed' },
      });

    const attachment = {
      id: 1460,
      kind: 'VIDEO',
      mimeType: 'video/mp4',
      url: 'uploads/u7/test-video.mp4',
      width: 1080,
      height: 1920,
    };

    const { container } = render(
      <ProtectedMessageAttachment
        viewerId={7}
        attachment={attachment}
        index={0}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const video = container.querySelector('video');

    expect(video).not.toBeNull();
    expect(video.getAttribute('src')).toContain('token=first');

    await act(async () => {
      jest.advanceTimersByTime(40000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(axiosClient.get).toHaveBeenCalledTimes(2);

    expect(video.getAttribute('src')).toContain('token=first');
  } finally {
    jest.useRealTimers();
  }
});



test('expired video capability is replaced when playback starts', async () => {
  jest.useFakeTimers();

  try {
    const makeGrant = (name, expiresAtSeconds) => {
      const payload = btoa(JSON.stringify({
        exp: expiresAtSeconds,
      }));

      return `/private-media/file?token=header.${payload}.signature-${name}`;
    };

    const now = Math.floor(Date.now() / 1000);

    axiosClient.get
      .mockResolvedValueOnce({
        data: {
          url: makeGrant('initial', now + 60),
        },
      })
      .mockResolvedValueOnce({
        data: {
          url: makeGrant('renewed', now + 100),
        },
      });

    const attachment = {
      id: 1460,
      kind: 'VIDEO',
      mimeType: 'video/mp4',
      url: 'uploads/u7/fox-video.mp4',
      width: 1080,
      height: 1920,
    };

    const { container } = render(
      <ProtectedMessageAttachment
        viewerId={7}
        attachment={attachment}
        index={0}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const video = container.querySelector('video');

    expect(video).not.toBeNull();

    const initialSource = video.getAttribute('src');

    await act(async () => {
      jest.advanceTimersByTime(40000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(axiosClient.get).toHaveBeenCalledTimes(2);
    expect(video.getAttribute('src')).toBe(initialSource);

    await act(async () => {
      jest.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(video.getAttribute('src')).toBe(initialSource);

    await act(async () => {
      fireEvent.play(video);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(video.getAttribute('src')).toContain('signature-renewed');
    expect(video.getAttribute('src')).not.toBe(initialSource);
  } finally {
    jest.useRealTimers();
  }
});


test('preserves playback position during capability recovery', async () => {
  jest.useFakeTimers();

  try {
    axiosClient.get
      .mockResolvedValueOnce({
        data: { url: '/private-media/file?token=initial' },
      })
      .mockResolvedValueOnce({
        data: { url: '/private-media/file?token=renewed' },
      });

    const { container } = render(
      <ProtectedMessageAttachment
        viewerId={7}
        index={0}
        attachment={{
          id: 1460,
          kind: 'VIDEO',
          mimeType: 'video/mp4',
          url: 'uploads/u7/recovery-position.mp4',
        }}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const video = container.querySelector('video');

    expect(video).not.toBeNull();

    const pause = jest.fn();
    const play = jest.fn().mockResolvedValue(undefined);

    Object.defineProperty(video, 'pause', {
      configurable: true,
      value: pause,
    });

    Object.defineProperty(video, 'play', {
      configurable: true,
      value: play,
    });

    video.currentTime = 1.75;

    await act(async () => {
      jest.advanceTimersByTime(40000);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(30000);
      fireEvent.play(video);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(video.getAttribute('src')).toContain('token=renewed');
    expect(pause).toHaveBeenCalled();

    video.currentTime = 0;

    await act(async () => {
      fireEvent.loadedMetadata(video);
      await Promise.resolve();
    });

    expect(video.currentTime).toBeCloseTo(1.75, 2);
    expect(play).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('denied playback recovery clears private video access', async () => {
  jest.useFakeTimers();

  try {
    axiosClient.get
      .mockResolvedValueOnce({
        data: { url: '/private-media/file?token=initial' },
      })
      .mockResolvedValueOnce({
        data: { url: '/private-media/file?token=renewed' },
      })
      .mockRejectedValueOnce({
        response: { status: 403 },
      });

    const { container } = render(
      <ProtectedMessageAttachment
        viewerId={7}
        index={0}
        attachment={{
          id: 1460,
          kind: 'VIDEO',
          mimeType: 'video/mp4',
          url: 'uploads/u7/denied-recovery.mp4',
        }}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const video = container.querySelector('video');

    expect(video).not.toBeNull();

    Object.defineProperty(video, 'pause', {
      configurable: true,
      value: jest.fn(),
    });

    await act(async () => {
      jest.advanceTimersByTime(40000);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(70000);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.play(video);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(axiosClient.get).toHaveBeenCalledTimes(3);

    expect(container.querySelector('video')).toBeNull();

    expect(screen.getByRole('status')).toHaveTextContent(
      'Media unavailable or loading'
    );

    expect(container.innerHTML).not.toContain(
      'uploads/u7/denied-recovery.mp4'
    );
  } finally {
    jest.useRealTimers();
  }
});

test('a rejected video capability renewal removes the previous source', async () => {
  jest.useFakeTimers();

  try {
    axiosClient.get
      .mockResolvedValueOnce({
        data: { url: '/private-media/file?token=first' },
      })
      .mockRejectedValueOnce({
        response: { status: 403 },
      });

    const attachment = {
      id: 1460,
      kind: 'VIDEO',
      mimeType: 'video/mp4',
      url: 'uploads/u7/test-video.mp4',
    };

    const { container } = render(
      <ProtectedMessageAttachment
        viewerId={7}
        attachment={attachment}
        index={0}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'https://api.chatforia.com/private-media/file?token=first'
    );

    await act(async () => {
      jest.advanceTimersByTime(40000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(axiosClient.get).toHaveBeenCalledTimes(2);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Media unavailable or loading'
    );
  } finally {
    jest.useRealTimers();
  }
});


test('a temporary capability renewal failure preserves the loaded video', async () => {
  jest.useFakeTimers();

  try {
    axiosClient.get
      .mockResolvedValueOnce({
        data: { url: '/private-media/file?token=first' },
      })
      .mockRejectedValueOnce(new Error('Network Error'));

    const attachment = {
      id: 1460,
      kind: 'VIDEO',
      mimeType: 'video/mp4',
      url: 'uploads/u7/test-video.mp4',
    };

    const { container } = render(
      <ProtectedMessageAttachment
        viewerId={7}
        attachment={attachment}
        index={0}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const video = container.querySelector('video');

    expect(video).not.toBeNull();

    const originalSrc = video.getAttribute('src');

    await act(async () => {
      jest.advanceTimersByTime(40000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(axiosClient.get).toHaveBeenCalledTimes(2);
    expect(container.querySelector('video')).toBe(video);
    expect(video.getAttribute('src')).toBe(originalSrc);
  } finally {
    jest.useRealTimers();
  }
});


test('a failed video can request fresh authorization on retry', async () => {
  axiosClient.get
    .mockResolvedValueOnce({
      data: { url: '/private-media/file?token=first' },
    })
    .mockResolvedValueOnce({
      data: { url: '/private-media/file?token=second' },
    });

  const attachment = {
    id: 1460,
    kind: 'VIDEO',
    mimeType: 'video/mp4',
    url: 'uploads/u7/test-video.mp4',
  };

  const { container } = render(
    <ProtectedMessageAttachment
      viewerId={7}
      attachment={attachment}
      index={0}
    />
  );

  await waitFor(() => {
    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'https://api.chatforia.com/private-media/file?token=first'
    );
  });

  fireEvent.error(container.querySelector('video'));

  const retry = await screen.findByRole('button', {
    name: /retry video/i,
  });

  fireEvent.click(retry);

  await waitFor(() => {
    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'https://api.chatforia.com/private-media/file?token=second'
    );
  });

  expect(axiosClient.get).toHaveBeenCalledTimes(2);
});
