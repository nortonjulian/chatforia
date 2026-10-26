import { render, screen, waitFor } from '@testing-library/react';
import ProtectedMessageAttachment from '../ProtectedMessageAttachment';
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

test('external media URLs are unchanged and never require private local authorization', () => {
  render(<ProtectedMessageAttachment viewerId={2} attachment={{
    id: 31, kind: 'AUDIO', mimeType: 'audio/mpeg', url: 'https://cdn.example.com/note.mp3',
  }} index={0} />);
  expect(document.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example.com/note.mp3');
  expect(axiosClient.get).not.toHaveBeenCalled();
});
