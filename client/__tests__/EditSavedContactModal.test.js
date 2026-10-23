import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

import axiosClient from '../src/api/axiosClient';
import EditSavedContactModal from '../src/components/EditSavedContactModal.jsx';
import ContactList from '../src/components/ContactList.jsx';

beforeEach(() => jest.clearAllMocks());

const renderModal = (contact, props = {}) => {
  const onClose = jest.fn();
  const onSaved = jest.fn();

  render(
    <MantineProvider>
      <EditSavedContactModal
        contact={contact}
        onClose={onClose}
        onSaved={onSaved}
        {...props}
      />
    </MantineProvider>
  );

  return { onClose, onSaved };
};

test('updates Chatforia alias and favorite without changing identity', async () => {
  const contact = {
    id: 7,
    userId: 5,
    user: { username: 'regina' },
    alias: '',
    favorite: false,
  };

  const { onSaved } = renderModal(contact);
  axiosClient.patch.mockResolvedValueOnce({
    data: { ...contact, alias: 'Friend', favorite: true },
  });

  fireEvent.change(screen.getByRole('textbox', { name: 'Alias' }), {
    target: { value: 'Friend' },
  });
  fireEvent.click(screen.getByRole('switch', { name: 'Favorite' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

  await waitFor(() => {
    expect(axiosClient.patch).toHaveBeenCalledWith('/contacts', {
      userId: 5,
      alias: 'Friend',
      favorite: true,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

test('updates a phone contact name without changing its number', async () => {
  const contact = {
    id: 8,
    externalPhone: '+15551234567',
    externalName: 'Old Name',
    favorite: false,
  };

  const { onSaved } = renderModal(contact);
  axiosClient.patch.mockResolvedValueOnce({
    data: { ...contact, externalName: 'New Name' },
  });

  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'New Name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

  await waitFor(() => {
    expect(axiosClient.patch).toHaveBeenCalledWith('/contacts', {
      externalPhone: '+15551234567',
      externalName: 'New Name',
      alias: '',
      favorite: false,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

test('Cancel closes without saving', () => {
  const { onClose } = renderModal({
    id: 9,
    userId: 5,
    user: { username: 'regina' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(axiosClient.patch).not.toHaveBeenCalled();
});

test('failed saves keep the dialog open and display the error', async () => {
  const { onSaved } = renderModal({
    id: 10,
    userId: 5,
    user: { username: 'regina' },
  });

  axiosClient.patch.mockRejectedValueOnce({
    response: { data: { error: 'Unable to save contact.' } },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

  expect(await screen.findByText('Unable to save contact.')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Edit contact' })).toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
});

test('the Saved Contacts pencil opens the edit dialog', async () => {
  axiosClient.get.mockResolvedValueOnce({
    data: [{ id: 11, userId: 5, user: { username: 'regina' } }],
  });

  render(
    <MantineProvider>
      <MemoryRouter>
        <ContactList currentUserId={1} />
      </MemoryRouter>
    </MantineProvider>
  );

  expect(await screen.findByText('regina')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Edit contact' }));

  expect(screen.getByRole('dialog', { name: 'Edit contact' })).toBeInTheDocument();
});
