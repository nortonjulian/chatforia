import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import SmsMediaGalleryModal from '../SmsMediaGalleryModal.jsx';

jest.mock('../SmsMessageMedia.jsx', () => ({
  __esModule: true,
  default: ({ messageId, mediaIndex, accountKey }) => (
    <div data-testid="secure-sms-media">
      {accountKey}:{messageId}:{mediaIndex}
    </div>
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
  expect(screen.getAllByTestId('secure-sms-media')).toHaveLength(2);
  expect(screen.getByText('1:241:0')).toBeTruthy();
  expect(screen.getByText('1:242:0')).toBeTruthy();
});
