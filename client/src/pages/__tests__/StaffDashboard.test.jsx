import { MantineProvider } from '@mantine/core';
import {
  render as rtlRender,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';

import axiosClient from '../../api/axiosClient';
import StaffDashboard from '../StaffDashboard';
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
test.each([
  ['ACCESS_ADMIN', 'SUPPORT', '/staff'],
  ['FOUNDER', 'CTO', '/staff/founder'],
  ['FOUNDER', 'ACCESS_ADMIN', '/staff/founder'],
])('%s submits a reason and target without client authentication claims (%s)', async (actorProfile, targetProfile, prefix) => {
  axiosClient.get.mockImplementation((path) =>
    Promise.resolve({
      data:
        path === '/staff/session'
          ? {
              profile: actorProfile,
              permissions: ['staff.read', 'staff.assign'],
              delegatableProfiles: [targetProfile],
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
      `${prefix}/assignments/16/grant`,
      { profile: targetProfile, reason: 'Approved access change' }
    )
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Access updated');
});

test('support resolves reports with a required reason', async () => {
  axiosClient.get.mockImplementation((path) =>
    Promise.resolve({
      data:
        path === '/staff/session'
          ? {
              profile: 'SUPPORT',
              permissions: ['reports.read', 'reports.resolve'],
              delegatableProfiles: [],
            }
          : { items: [], total: 0 },
    })
  );
  axiosClient.post.mockResolvedValue({ data: { changed: true } });
  render(<StaffDashboard />);
  await screen.findByText('Resolve report', { selector: 'h2' });
  fireEvent.change(screen.getByLabelText('Report ID'), {
    target: { value: '29' },
  });
  fireEvent.change(screen.getByLabelText('Resolution reason'), {
    target: { value: 'Verified report resolution' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Resolve report' }));
  await waitFor(() =>
    expect(axiosClient.post).toHaveBeenCalledWith('/staff/reports/29/resolve', {
      reason: 'Verified report resolution',
    })
  );
});

test.each([
  ['ACCESS_ADMIN', 'SUPPORT', '/staff'],
  ['FOUNDER', 'CTO', '/staff/founder'],
  ['FOUNDER', 'ACCESS_ADMIN', '/staff/founder'],
])('%s revocation submits the chosen target and reason (%s)', async (actorProfile, targetProfile, prefix) => {
  axiosClient.get.mockImplementation((path) =>
    Promise.resolve({
      data:
        path === '/staff/session'
          ? {
              profile: actorProfile,
              permissions: ['staff.read', 'staff.assign'],
              delegatableProfiles: [targetProfile],
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
    target: { value: 'Verified access revocation' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
  await waitFor(() =>
    expect(axiosClient.post).toHaveBeenCalledWith(
      `${prefix}/assignments/16/revoke`,
      { profile: targetProfile, reason: 'Verified access revocation' }
    )
  );
});

test('session loss clears protected content and management controls', async () => {
  axiosClient.get.mockImplementation((path) =>
    path === '/staff/session'
      ? Promise.resolve({
          data: {
            profile: 'SUPPORT',
            permissions: ['users.read', 'reports.read'],
            delegatableProfiles: [],
          },
        })
      : path === '/staff/users'
        ? Promise.resolve({
            data: { items: [{ id: 4, username: 'Private fixture' }], total: 1 },
          })
        : Promise.reject(new Error('Session revoked'))
  );
  render(<StaffDashboard />);
  await screen.findByText('Private fixture');
  fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Private fixture')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});

function render(ui) {
  return rtlRender(<MantineProvider>{ui}</MantineProvider>);
}
