import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), delete: jest.fn() },
}));
import axiosClient from '../src/api/axiosClient';
import BlockedAccountsPanel from '../src/components/profile/BlockedAccountsPanel.jsx';

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());
const show = () => render(<MantineProvider><BlockedAccountsPanel /></MantineProvider>);

test('shows persistent blocked Chatforia accounts from authenticated API', async () => {
  axiosClient.get.mockResolvedValueOnce({ data: { items: [
    { userId: 22, username: 'regina', displayName: 'Regina' },
  ] } });
  show();
  expect(await screen.findByText('Regina (@regina)')).toBeInTheDocument();
  expect(axiosClient.get).toHaveBeenCalledWith('/blocks');
});

test('requires confirmation and unblocks by target user id', async () => {
  axiosClient.get.mockResolvedValueOnce({ data: { items: [
    { userId: 22, username: 'regina', displayName: 'Regina' },
  ] } });
  axiosClient.delete.mockResolvedValueOnce({ data: { success: true } });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Unblock' }));
  await waitFor(() => expect(axiosClient.delete).toHaveBeenCalledWith('/blocks/22'));
  expect(await screen.findByText('No blocked accounts.')).toBeInTheDocument();
});

test('canceling unblock leaves the account blocked', async () => {
  axiosClient.get.mockResolvedValueOnce({ data: { items: [
    { userId: 22, username: 'regina', displayName: 'Regina' },
  ] } });
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Unblock' }));
  expect(axiosClient.delete).not.toHaveBeenCalled();
  expect(screen.getByText('Regina (@regina)')).toBeInTheDocument();
});

test('failed GET shows error instead of silently appearing empty', async () => {
  axiosClient.get.mockRejectedValueOnce(new Error('Network unavailable'));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
});
