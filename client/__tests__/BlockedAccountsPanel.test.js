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

test('requires an in-app confirmation and unblocks by target user id', async () => {
  axiosClient.get.mockResolvedValueOnce({ data: { items: [
    { userId: 22, username: 'regina', displayName: 'Regina' },
  ] } });
  axiosClient.delete.mockResolvedValueOnce({ data: { success: true } });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Unblock' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Unblock Chatforia account?');
  expect(axiosClient.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Unblock account' }));
  await waitFor(() => expect(axiosClient.delete).toHaveBeenCalledWith('/blocks/22'));
  expect(await screen.findByText('No blocked accounts.')).toBeInTheDocument();
});

test('canceling the dialog leaves the account blocked', async () => {
  axiosClient.get.mockResolvedValueOnce({ data: { items: [
    { userId: 22, username: 'regina', displayName: 'Regina' },
  ] } });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Unblock' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(axiosClient.delete).not.toHaveBeenCalled();
  expect(screen.getByText('Regina (@regina)')).toBeInTheDocument();
});

test('failed GET shows error instead of silently appearing empty', async () => {
  axiosClient.get.mockRejectedValueOnce(new Error('Network unavailable'));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
});

test('failed unblock keeps the confirmation open and displays the error', async () => {
  axiosClient.get.mockResolvedValueOnce({ data: { items: [
    { userId: 22, username: 'regina', displayName: 'Regina' },
  ] } });
  axiosClient.delete.mockRejectedValueOnce(new Error('Network unavailable'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Unblock' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unblock account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('Regina (@regina)')).toBeInTheDocument();
});
