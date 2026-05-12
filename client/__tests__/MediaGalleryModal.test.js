/** @jest-environment jsdom */

import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
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

  renderWithRouter(<MediaGalleryModal opened roomId={5} onClose={() => {}} />);

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

  renderWithRouter(<MediaGalleryModal opened roomId={42} onClose={() => {}} />);

  const gallery = await screen.findByRole('dialog', { name: /shared media/i });

  expect(gallery).toBeInTheDocument();
  expect(within(gallery).getByText(/no media cached locally yet/i)).toBeInTheDocument();
});

test('normalizes legacy fields (imageUrl) and reverses order (newest first)', async () => {
  mockGetMediaInRoom.mockResolvedValueOnce([
    { id: 101, imageUrl: 'http://x/legacy1.jpg', caption: 'legacy one' },
    { id: 102, kind: 'IMAGE', url: 'http://x/newer.jpg', caption: 'newest' },
  ]);

  renderWithRouter(<MediaGalleryModal opened roomId={7} onClose={() => {}} />);

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