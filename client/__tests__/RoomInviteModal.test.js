/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test-utils';

const mockPost = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...args) => mockPost(...args),
  },
}));

const mockToDataURL = jest.fn(() =>
  Promise.resolve('data:image/png;base64,AAA=')
);

jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: (...args) => mockToDataURL(...args),
  },
}));

jest.mock('@mantine/notifications', () => ({
  __esModule: true,
  notifications: {
    show: jest.fn(),
  },
}));

import RoomInviteModal from '@/components/RoomInviteModal.jsx';

beforeEach(() => {
  jest.clearAllMocks();
  window.open = jest.fn();
});

test('generates invite + QR and shows copy/open controls', async () => {
  const user = userEvent.setup();

  mockPost.mockResolvedValueOnce({
    data: { url: 'https://invite/link' },
  });

  renderWithRouter(
    <RoomInviteModal opened onClose={() => {}} roomId={42} />
  );

  await user.click(
    screen.getByRole('button', { name: /generate link/i })
  );

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith('/chatrooms/42/invites', {
      expiresInMinutes: 1440,
      maxUses: 0,
    });
  });

  expect(
    await screen.findByDisplayValue('https://invite/link')
  ).toBeInTheDocument();

  expect(mockToDataURL).toHaveBeenCalledWith('https://invite/link', {
    errorCorrectionLevel: 'M',
  });

  await user.click(screen.getByRole('button', { name: /open invite link/i }));

  expect(window.open).toHaveBeenCalledWith(
    'https://invite/link',
    '_blank'
  );
});