import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

import axiosClient from '../src/api/axiosClient';
import BlockedNumbersPanel from '../src/components/profile/BlockedNumbersPanel.jsx';

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

const showPanel = () =>
  render(
    <MantineProvider>
      <BlockedNumbersPanel />
    </MantineProvider>
  );

test('loads blocked numbers from the account API', async () => {
  axiosClient.get.mockResolvedValueOnce({
    data: { items: [{ id: 7, phone: '+15551234567' }] },
  });

  showPanel();

  expect(await screen.findByText('+15551234567')).toBeInTheDocument();
  expect(axiosClient.get).toHaveBeenCalledWith('/sms/blocked-numbers');
});

test('blocks a number and displays the confirmed result', async () => {
  axiosClient.get.mockResolvedValueOnce({ data: { items: [] } });
  axiosClient.post.mockResolvedValueOnce({
    data: {
      success: true,
      item: { id: 8, phone: '+15551234567' },
    },
  });

  showPanel();
  await screen.findByText('No blocked numbers.');

  fireEvent.change(
    screen.getByRole('textbox', { name: 'Phone number to block' }),
    { target: { value: '+15551234567' } }
  );

  fireEvent.click(screen.getByRole('button', { name: 'Block number' }));

  await waitFor(() =>
    expect(axiosClient.post).toHaveBeenCalledWith(
      '/sms/blocked-numbers',
      { phone: '+15551234567' }
    )
  );

  expect(await screen.findByText('+15551234567')).toBeInTheDocument();
});

test('unblocks only after in-app confirmation', async () => {
  axiosClient.get.mockResolvedValueOnce({
    data: { items: [{ id: 9, phone: '+15551234567' }] },
  });
  axiosClient.delete.mockResolvedValueOnce({ data: { success: true, id: 9 } });
  showPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Unblock +15551234567' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Unblock phone number?');
  expect(axiosClient.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Unblock number' }));
  await waitFor(() => expect(axiosClient.delete).toHaveBeenCalledWith('/sms/blocked-numbers/9'));
  expect(await screen.findByText('No blocked numbers.')).toBeInTheDocument();
});

test('canceling the in-app dialog preserves the blocked number', async () => {
  axiosClient.get.mockResolvedValueOnce({
    data: { items: [{ id: 10, phone: '+15551234567' }] },
  });
  showPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Unblock +15551234567' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(axiosClient.delete).not.toHaveBeenCalled();
  expect(screen.getByText('+15551234567')).toBeInTheDocument();
});

test('block failures display an error without adding a number', async () => {
  axiosClient.get.mockResolvedValueOnce({ data: { items: [] } });
  axiosClient.post.mockRejectedValueOnce({
    response: { data: { error: 'Invalid phone number.' } },
  });

  showPanel();
  await screen.findByText('No blocked numbers.');

  fireEvent.change(
    screen.getByRole('textbox', { name: 'Phone number to block' }),
    { target: { value: 'invalid' } }
  );

  fireEvent.click(screen.getByRole('button', { name: 'Block number' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Invalid phone number.'
  );
  expect(screen.getByText('No blocked numbers.')).toBeInTheDocument();
});

test('failed list requests display an error', async () => {
  axiosClient.get.mockRejectedValueOnce(new Error('Network unavailable'));

  showPanel();

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Network unavailable'
  );
});

test('failed number unblock displays error without removing the block', async () => {
  axiosClient.get.mockResolvedValueOnce({
    data: { items: [{ id: 9, phone: '+15551234567' }] },
  });
  axiosClient.delete.mockRejectedValueOnce(new Error('Network unavailable'));
  showPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Unblock +15551234567' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unblock number' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getAllByText('+15551234567').length).toBeGreaterThan(0);
});
