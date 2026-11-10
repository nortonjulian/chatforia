import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StaffDashboard from '../StaffDashboard';
const mockGet = jest.fn();
jest.mock('../../api/axiosClient', () => ({ __esModule: true, default: { get: (...args) => mockGet(...args) } }));
jest.mock('@mantine/core', () => ({ ScrollArea: ({ children, h }) => <div data-testid="records-scroll" data-height={h}>{children}</div> }), { virtual: true });
jest.mock('../../components/admin/DashboardButton.jsx', () => ({ DashboardButton: ({ primary, ...props }) => <button {...props} /> }));
jest.mock('../../components/admin/UserDetailsDialog.jsx', () => ({ __esModule: true, default: () => null }));
beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation((path) => Promise.resolve({ data: path === '/staff/session'
    ? { profile: 'SUPPORT', permissions: ['users.read'], delegatableProfiles: [] }
    : { items: [{ id: 1, username: 'julian' }], total: 34 } }));
});
test('search resets pagination, sends the query, and clear restores the list', async () => {
  render(<StaffDashboard />);
  await screen.findByText('julian');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/staff/users', { params: { take: 25, skip: 25 } }));
  await screen.findByText('julian');
  fireEvent.change(screen.getByLabelText('Search users by username or User ID'), { target: { value: ' julian ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/staff/users', { params: { take: 25, skip: 0, query: 'julian' } }));
  await screen.findByText('julian');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/staff/users', { params: { take: 25, skip: 0 } }));
});
test('populated records use a bounded scrolling region and no grant controls for SUPPORT', async () => {
  render(<StaffDashboard />);
  await screen.findByText('julian');
  expect(screen.getByTestId('records-scroll').getAttribute('data-height')).toBe('min(55dvh, 560px)');
  expect(screen.queryByRole('button', { name: 'Grant or change access' })).toBeNull();
});
