import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SharedImageViewer, { IMAGE_VIEWER_WIDTH, IMAGE_VIEWER_HEIGHT, CAPTIONED_IMAGE_VIEWER_HEIGHT, imageDownloadName } from '../SharedImageViewer';

beforeEach(() => {
  URL.createObjectURL = jest.fn(() => 'blob:full-quality');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test('both channels use the same large, uncropped image stage and control positions', async () => {
  const blob = new Blob(['original pixels'], { type: 'image/png' });
  const view = render(<SharedImageViewer opened onClose={() => {}} blob={blob}
    onDownload={async () => blob} alt="Portrait fixture" />);
  const image = await screen.findByRole('img', { name: 'Portrait fixture' });
  expect(IMAGE_VIEWER_WIDTH).toBe('min(96vw, 1200px)');
  expect(IMAGE_VIEWER_HEIGHT).toBe('calc(94dvh - 170px)');
  expect(CAPTIONED_IMAGE_VIEWER_HEIGHT).toBe('calc(94dvh - 205px)');
  expect(image).toHaveClass('shared-image-viewer-image');
  expect(image.closest('.shared-image-viewer-stage')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Close' }).closest('.shared-image-viewer-header')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download image' }).closest('.shared-image-viewer-footer')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Back to media' })).toBeNull();
  view.rerender(<SharedImageViewer opened onClose={() => {}} onBack={() => {}} blob={blob}
    onDownload={async () => blob} alt="Portrait fixture" />);
  expect(screen.getByRole('button', { name: 'Back to media' })).toBeTruthy();
});

test('download uses fresh bytes and an appropriate image extension', async () => {
  const displayed = new Blob(['preview'], { type: 'image/jpeg' });
  const original = new Blob(['original'], { type: 'image/png' });
  const refresh = jest.fn(async () => original);
  const user = userEvent.setup();
  render(<SharedImageViewer opened onClose={() => {}} blob={displayed}
    filename="portrait.jpg" onDownload={refresh} />);
  await user.click(screen.getByRole('button', { name: 'Download image' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  expect(imageDownloadName(original, 'portrait.jpg')).toBe('portrait.png');
  expect(document.querySelector('a[href^="http"]')).toBeNull();
});

test('failed renewed authorization does not download stale displayed bytes', async () => {
  const blob = new Blob(['old'], { type: 'image/png' });
  const user = userEvent.setup();
  render(<SharedImageViewer opened onClose={() => {}} blob={blob}
    onDownload={async () => { throw new Error('revoked'); }} />);
  await user.click(screen.getByRole('button', { name: 'Download image' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not download');
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

test('closing releases the temporary viewer URL', async () => {
  const blob = new Blob(['image'], { type: 'image/png' });
  const view = render(<SharedImageViewer opened onClose={() => {}} blob={blob}
    onDownload={async () => blob} />);
  await screen.findByRole('img');
  view.rerender(<SharedImageViewer opened={false} onClose={() => {}} blob={blob}
    onDownload={async () => blob} />);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:full-quality');
});

test('a download completing after the viewer closes cannot save stale media', async () => {
  const blob = new Blob(['image'], { type: 'image/png' });
  let finish;
  const onDownload = () => new Promise((resolve) => { finish = resolve; });
  const user = userEvent.setup();
  const view = render(<SharedImageViewer opened onClose={() => {}} blob={blob}
    onDownload={onDownload} />);
  await user.click(screen.getByRole('button', { name: 'Download image' }));
  view.rerender(<SharedImageViewer opened={false} onClose={() => {}} blob={blob}
    onDownload={onDownload} />);
  await act(async () => finish(blob));
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

test('disappearing image viewer closes when its existing expiry is reached', () => {
  jest.useFakeTimers();
  const onClose = jest.fn();
  const blob = new Blob(['image'], { type: 'image/png' });
  render(<SharedImageViewer opened onClose={onClose} blob={blob}
    expiresAt={new Date(Date.now() + 1000).toISOString()}
    onDownload={async () => blob} />);
  expect(onClose).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1000));
  expect(onClose).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
