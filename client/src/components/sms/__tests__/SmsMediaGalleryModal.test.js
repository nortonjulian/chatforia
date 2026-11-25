import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SmsMediaGalleryModal from '../SmsMediaGalleryModal.jsx';

beforeEach(() => {
  URL.createObjectURL = jest.fn(() => 'blob:gallery-viewer');
  URL.revokeObjectURL = jest.fn();
});

jest.mock('../SmsMessageMedia.jsx', () => ({
  __esModule: true,
  default: ({ messageId, mediaIndex, accountKey, presentation, onOpenImage }) => (
    <button type="button" onClick={() => onOpenImage?.({ blob: new Blob(['fixture'], { type: 'image/png' }) })} data-testid={`secure-sms-media-${presentation}`}>
      {accountKey}:{messageId}:{mediaIndex}
    </button>
  ),
}));

afterEach(cleanup);

test('shows genuine empty state for an empty thread', () => {
  render(
    <SmsMediaGalleryModal
      opened
      onClose={() => {}}
      title="regina"
      accountKey="1"
      items={[]}
    />
  );
  expect(screen.getByText('No media yet.')).toBeTruthy();
});

test('shows current inbound and outbound media through authenticated loader', () => {
  render(
    <SmsMediaGalleryModal
      opened
      onClose={() => {}}
      title="regina"
      accountKey="1"
      items={[
        { id: '241:0', messageId: 241, mediaIndex: 0, item: 'uploads/u65/image.jpg' },
        { id: '242:0', messageId: 242, mediaIndex: 0, item: 'https://api.twilio.com/media' },
      ]}
    />
  );
  expect(screen.queryByText('No media yet.')).toBeNull();
  expect(screen.getAllByTestId('secure-sms-media-gallery')).toHaveLength(2);
  expect(screen.getByText('1:241:0')).toBeTruthy();
  expect(screen.getByText('1:242:0')).toBeTruthy();
});

test('keyboard opens the full-size viewer, and account changes close the old selection', async () => {
  const item = { id: '241:0', messageId: 241, mediaIndex: 0, item: 'opaque-image' };
  const view=render(<SmsMediaGalleryModal opened onClose={() => {}} accountKey="1" items={[item]}/>);
  const tile=screen.getByTestId('secure-sms-media-gallery');
  const user=userEvent.setup();
  tile.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog',{name:'Image viewer'})).toBeInTheDocument();
  expect(screen.getByRole('img',{name:'MMS attachment'})).toHaveAttribute('src','blob:gallery-viewer');
  await user.click(screen.getByRole('button',{name:'Back to media'}));
  expect(screen.queryByRole('dialog',{name:'Image viewer'})).toBeNull();
  await user.click(screen.getByTestId('secure-sms-media-gallery'));
  view.rerender(<SmsMediaGalleryModal opened onClose={() => {}} accountKey="2" items={[item]}/>);
  expect(screen.queryByRole('dialog',{name:'Image viewer'})).toBeNull();
});
