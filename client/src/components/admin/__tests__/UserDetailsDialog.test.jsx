import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import api from '../../../api/axiosClient';
import UserDetailsDialog from '../UserDetailsDialog';

jest.mock('../../../api/axiosClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
const current = {
  user: {
    id: 2,
    username: 'synthetic',
    displayName: 'Current name',
    preferredLanguage: 'en',
    showReadReceipts: true,
    showOriginalWithTranslation: true,
    role: 'USER',
    isBanned: false,
    passwordHash: 'NEVER_RENDER_SECRET',
  },
  editableFields: [
    'displayName',
    'preferredLanguage',
    'showReadReceipts',
    'showOriginalWithTranslation',
  ],
  version: 'a'.repeat(64),
};
beforeEach(() => {
  jest.resetAllMocks();
  api.get.mockResolvedValue({ data: current });
});
test('View loads selected details but never renders unknown credential fields', async () => {
  render(<UserDetailsDialog userId={2} onClose={jest.fn()} />);
  expect(await screen.findByText('synthetic')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/admin/users/2');
  expect(screen.queryByText('NEVER_RENDER_SECRET')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Save changes' })
  ).not.toBeInTheDocument();
});
test('Edit loads current values and Cancel does not save', async () => {
  const close = jest.fn();
  render(<UserDetailsDialog userId={2} mode="edit" onClose={close} />);
  expect(await screen.findByLabelText('Display name')).toHaveValue(
    'Current name'
  );
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Cancelled name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
});
test('Edit sends only allowed fields and refreshes its parent after saving', async () => {
  const saved = jest.fn(),
    close = jest.fn();
  api.patch.mockResolvedValue({
    data: { user: { ...current.user, displayName: 'New name' } },
  });
  render(
    <UserDetailsDialog userId={2} mode="edit" onClose={close} onSaved={saved} />
  );
  await screen.findByLabelText('Display name');
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'New name' },
  });
  fireEvent.change(screen.getByLabelText('Change reason'), {
    target: { value: 'Verified preference correction' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(api.patch).toHaveBeenCalledWith('/admin/users/2', {
    changes: {
      displayName: 'New name',
      preferredLanguage: 'en',
      showReadReceipts: true,
      showOriginalWithTranslation: true,
    },
    version: current.version,
    reason: 'Verified preference correction',
  });
  expect(close).toHaveBeenCalled();
});
test('protected or read-only identities never get save controls', async () => {
  api.get.mockResolvedValue({ data: { ...current, editableFields: [] } });
  render(<UserDetailsDialog userId={2} mode="edit" onClose={jest.fn()} />);
  expect(await screen.findByText(/identity is protected/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Save changes' })
  ).not.toBeInTheDocument();
});
test('a save denial removes editable fields and does not refresh with unconfirmed data', async () => {
  api.patch.mockRejectedValue({
    response: { status: 403, data: { error: 'Current session denied' } },
  });
  const saved = jest.fn();
  render(
    <UserDetailsDialog
      userId={2}
      mode="edit"
      onClose={jest.fn()}
      onSaved={saved}
    />
  );
  await screen.findByLabelText('Display name');
  fireEvent.change(screen.getByLabelText('Change reason'), {
    target: { value: 'Denied preference correction' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Current session denied'
  );
  expect(
    screen.queryByRole('button', { name: 'Save changes' })
  ).not.toBeInTheDocument();
  expect(saved).not.toHaveBeenCalled();
});
