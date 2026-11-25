import { render, screen, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MediaGalleryModal from '../MediaGalleryModal';
import { getMediaInRoom } from '@/utils/messagesStore';
import { loadNativeImageBlob } from '../chat/loadNativeImageBlob';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key, fallback) => fallback || _key }),
}));
jest.mock('@/utils/messagesStore', () => ({
  getMediaInRoom: jest.fn(),
}));
jest.mock('../chat/ProtectedMessageAttachment', () => ({
  useAuthorizedMedia: () => ({ url: 'blob:authorized-inline' }),
  isLocalPrivateMedia: () => true,
}));
jest.mock('../chat/loadNativeImageBlob', () => ({
  loadNativeImageBlob: jest.fn(),
}));

beforeEach(() => {
  getMediaInRoom.mockResolvedValue([{
    id: 91, messageId: 12, kind: 'IMAGE',
    url: 'media/portrait.png', caption: 'Portrait QA image',
    mimeType: 'image/png',
  }]);
  loadNativeImageBlob.mockResolvedValue(new Blob(['original'], { type: 'image/png' }));
  URL.createObjectURL = jest.fn(() => 'blob:native-viewer');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('native gallery image uses the shared viewer, authorized attachment ID, and Back to media', async () => {
  const user = userEvent.setup();
  render(<MediaGalleryModal opened onClose={() => {}} roomId={1} accountId={2} />);
  const tile = await screen.findByRole('button', { name: 'Open image full size' });
  await user.click(tile);
  expect(screen.getByRole('dialog', { name: 'Image viewer' })).toBeInTheDocument();
  await within(screen.getByRole('dialog', { name: 'Image viewer' }))
    .findByRole('img', { name: 'Portrait QA image' });
  expect(loadNativeImageBlob).toHaveBeenCalledWith(
    expect.objectContaining({ id: 91, url: 'media/portrait.png' }),
    expect.objectContaining({ privateSource: true, signal: expect.any(Object) })
  );
  await user.click(screen.getByRole('button', { name: 'Back to media' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Image viewer' })).toBeNull());
  expect(await screen.findByRole('button', { name: 'Open image full size' })).toBeInTheDocument();
});

test('account changes clear a loaded native gallery image', async () => {
  const user = userEvent.setup();
  const view = render(<MediaGalleryModal opened onClose={() => {}} roomId={1} accountId={2} />);
  await user.click(await screen.findByRole('button', { name: 'Open image full size' }));
  await within(screen.getByRole('dialog', { name: 'Image viewer' })).findByRole('img');
  view.rerender(<MediaGalleryModal opened onClose={() => {}} roomId={1} accountId={3} />);
  expect(screen.queryByRole('dialog', { name: 'Image viewer' })).toBeNull();
});
