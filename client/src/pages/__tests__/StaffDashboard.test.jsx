import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import StaffDashboard from '../StaffDashboard';
import axiosClient from '../../api/axiosClient';
jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
beforeEach(() => {
  jest.resetAllMocks();
});
test('fails closed for an expired or unauthorized session', async () => {
  axiosClient.get.mockRejectedValue(new Error('Unauthorized'));
  render(<StaffDashboard />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'current MFA-verified session'
  );
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});
test('shows only server-authorized sections', async () => {
  axiosClient.get.mockImplementation((path) =>
    Promise.resolve({
      data:
        path === '/staff/session'
          ? {
              profile: 'SUPPORT',
              permissions: ['users.read', 'reports.read'],
              delegatableProfiles: [],
            }
          : { items: [{ id: 4, username: 'Example' }], total: 1 },
    })
  );
  render(<StaffDashboard />);
  expect(await screen.findByText('Example')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reports' })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Staff access' })
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Manage staff access')).not.toBeInTheDocument();
});
test('submits a reason and target without client authentication claims', async () => {
  axiosClient.get.mockImplementation((path) =>
    Promise.resolve({
      data:
        path === '/staff/session'
          ? {
              profile: 'ACCESS_ADMIN',
              permissions: ['staff.read', 'staff.assign'],
              delegatableProfiles: ['SUPPORT'],
            }
          : { items: [], total: 0 },
    })
  );
  axiosClient.post.mockResolvedValue({ data: { sessionsRevoked: true } });
  render(<StaffDashboard />);
  await screen.findByText('Manage staff access');
  fireEvent.change(screen.getByLabelText('User ID'), {
    target: { value: '16' },
  });
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Approved access change' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Grant or change access' })
  );
  await waitFor(() =>
    expect(axiosClient.post).toHaveBeenCalledWith(
      '/staff/assignments/16/grant',
      { profile: 'SUPPORT', reason: 'Approved access change' }
    )
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Access updated');
});
