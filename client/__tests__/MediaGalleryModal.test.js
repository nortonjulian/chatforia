/** @jest-environment jsdom */

import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import axiosClient from '../src/api/axiosClient';
import { screen, within } from '@testing-library/react';

// ---- messagesStore mock ----
const mockGetMediaInRoom = jest.fn();

jest.mock('../src/utils/messagesStore', () => ({
  __esModule: true,
  getMediaInRoom: (...args) => mockGetMediaInRoom(...args),
}));

import MediaGalleryModal from '../src/components/MediaGalleryModal.jsx';
import { renderWithRouter } from '../src/test-utils';

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders images/video/audio and opens viewer on image click', async () => {
  mockGetMediaInRoom.mockResolvedValueOnce([
    { id: 1, kind: 'IMAGE', url: 'http://x/img.jpg', caption: 'pic1' },
    { id: 2, kind: 'VIDEO', url: 'http://x/v.mp4' },
    { id: 3, kind: 'AUDIO', url: 'http://x/a.mp3' },
  ]);

  renderWithRouter(<MediaGalleryModal opened accountId={65} roomId={5} onClose={() => {}} />);

  const gallery = await screen.findByRole('dialog', { name: /shared media/i });
  expect(gallery).toBeInTheDocument();

  await userEvent.click(await screen.findByRole('img', { name: /pic1/i }));

  const dialogs = await screen.findAllByRole('dialog');
  const viewer = dialogs[1];

  expect(viewer).toBeInTheDocument();
  expect(within(viewer).getByRole('heading', { name: /pic1/i })).toBeInTheDocument();
  expect(within(viewer).getByText(/pic1/i, { selector: 'p' })).toBeInTheDocument();
  expect(within(viewer).getByRole('img', { name: /pic1/i })).toBeInTheDocument();
});

test('shows empty state when no media', async () => {
  mockGetMediaInRoom.mockResolvedValueOnce([]);

  renderWithRouter(<MediaGalleryModal opened accountId={65} roomId={42} onClose={() => {}} />);

  const gallery = await screen.findByRole('dialog', { name: /shared media/i });

  expect(gallery).toBeInTheDocument();
  expect(within(gallery).getByText(/no media cached locally yet/i)).toBeInTheDocument();
});

test('normalizes legacy fields (imageUrl) and reverses order (newest first)', async () => {
  mockGetMediaInRoom.mockResolvedValueOnce([
    { id: 101, imageUrl: 'http://x/legacy1.jpg', caption: 'legacy one' },
    { id: 102, kind: 'IMAGE', url: 'http://x/newer.jpg', caption: 'newest' },
  ]);

  renderWithRouter(<MediaGalleryModal opened accountId={65} roomId={7} onClose={() => {}} />);

  const gallery = await screen.findByRole('dialog', { name: /shared media/i });
  expect(gallery).toBeInTheDocument();

  const thumbs = await within(gallery).findAllByRole('img');

  expect(thumbs.length).toBeGreaterThanOrEqual(2);

  await userEvent.click(thumbs[0]);

  const dialogs = await screen.findAllByRole('dialog');
  const viewer = dialogs[1];

  expect(viewer).toBeInTheDocument();
  expect(within(viewer).getByRole('heading', { name: /newest/i })).toBeInTheDocument();
  expect(within(viewer).getByText(/newest/i, { selector: 'p' })).toBeInTheDocument();
  expect(within(viewer).getByRole('img', { name: /newest/i })).toBeInTheDocument();
});


test('private gallery images authorize using the message ID', async () => {
  const spy = jest.spyOn(axiosClient, 'get').mockResolvedValue({
    data: { url: '/private-media/file?token=gallery-image-qa' },
  });

  try {
    mockGetMediaInRoom.mockResolvedValueOnce([{
      id: 9001,
      messageId: 431,
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      url: 'uploads/u65/private-image.jpg',
      caption: 'Private QA image',
    }]);

    renderWithRouter(
      <MediaGalleryModal
        opened
        accountId={65}
        roomId={85}
        onClose={() => {}}
      />
    );

    const image = await screen.findByRole('img', {
      name: /private qa image/i,
    });

    await waitFor(() => {
      expect(image.getAttribute('src')).toContain(
        '/private-media/file?token=gallery-image-qa'
      );
    });

    expect(spy).toHaveBeenCalledWith(
      '/private-media/message/431',
      expect.objectContaining({
        params: { variant: 'file' },
      })
    );

    await userEvent.click(image);

    const dialogs = await screen.findAllByRole('dialog');
    const viewer = dialogs[dialogs.length - 1];

    await waitFor(() => {
      const enlarged = within(viewer).getByRole('img', {
        name: /private qa image/i,
      });

      expect(enlarged.getAttribute('src')).toContain(
        '/private-media/file?token=gallery-image-qa'
      );
    });

    await waitFor(() => {
      const download = within(viewer).getByRole('button', {
        name: /download/i,
      });
      expect(download).toHaveAttribute('component', 'a');
      expect(download).toHaveAttribute('download');
      expect(download.getAttribute('href')).toContain(
        '/private-media/file?token=gallery-image-qa'
      );
    });
  } finally {
    spy.mockRestore();
  }
});

test('private gallery videos authorize using the message ID', async () => {
  const spy = jest.spyOn(axiosClient, 'get').mockResolvedValue({
    data: { url: '/private-media/file?token=gallery-video-qa' },
  });

  try {
    mockGetMediaInRoom.mockResolvedValueOnce([{
      id: 9002,
      messageId: 432,
      kind: 'VIDEO',
      mimeType: 'video/mp4',
      url: 'uploads/u65/private-video.mp4',
    }]);

    renderWithRouter(
      <MediaGalleryModal
        opened
        accountId={65}
        roomId={85}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      const video = document.querySelector('video');
      expect(video).not.toBeNull();
      expect(video.getAttribute('src')).toContain(
        '/private-media/file?token=gallery-video-qa'
      );
    });

    expect(spy).toHaveBeenCalledWith(
      '/private-media/message/432',
      expect.objectContaining({
        params: { variant: 'file' },
      })
    );
  } finally {
    spy.mockRestore();
  }
});

test('denied gallery media never loads the private storage key', async () => {
  const spy = jest.spyOn(axiosClient, 'get').mockRejectedValue({
    response: { status: 403 },
  });

  try {
    mockGetMediaInRoom.mockResolvedValueOnce([{
      id: 9003,
      messageId: 433,
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      url: 'uploads/u65/forbidden-image.jpg',
    }]);

    renderWithRouter(
      <MediaGalleryModal
        opened
        accountId={65}
        roomId={85}
        onClose={() => {}}
      />
    );

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        '/private-media/message/433',
        expect.any(Object)
      );
    });

    await waitFor(() => {
      const image = document.querySelector('img');
      expect(image?.getAttribute('src') || '').not.toContain(
        'uploads/u65/forbidden-image.jpg'
      );
    });

    const mediaSources = Array.from(
      document.querySelectorAll('img,video,audio')
    ).map(element => element.getAttribute('src') || '');

    expect(mediaSources.join(' ')).not.toContain(
      'uploads/u65/forbidden-image.jpg'
    );
  } finally {
    spy.mockRestore();
  }
});
