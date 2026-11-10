import { render, screen, act, waitFor } from '@testing-library/react';
import StaffDashboardLink from '../StaffDashboardLink';

const mockGet = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args) },
}));
jest.mock(
  '@mantine/core',
  () => ({ Button: ({ children, to }) => <a href={to}>{children}</a> }),
  { virtual: true }
);
jest.mock('react-router-dom', () => ({ Link: () => null }), { virtual: true });
jest.mock(
  'react-i18next',
  () => ({ useTranslation: () => ({ t: (_, fallback) => fallback }) }),
  { virtual: true }
);
const session = {
  data: { profile: 'FOUNDER', permissions: ['staff.read', 'staff.assign'] },
};
beforeEach(() => mockGet.mockReset());

test('shows a direct staff link only after server authorization, without polling', async () => {
  mockGet.mockResolvedValue(session);
  render(<StaffDashboardLink userId={1} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(
    (await screen.findByRole('link', { name: 'Staff Dashboard' })).getAttribute(
      'href'
    )
  ).toBe('/staff');
  expect(mockGet).toHaveBeenCalledTimes(1);
});

test.each([401, 403, 404, 503])(
  'hides the link for HTTP %s',
  async (status) => {
    mockGet.mockRejectedValue({ response: { status } });
    await act(async () => {
      render(<StaffDashboardLink userId={1} />);
    });
    expect(screen.queryByRole('link')).toBeNull();
  }
);

test('does not request access when signed out', () => {
  render(<StaffDashboardLink />);
  expect(mockGet).not.toHaveBeenCalled();
});

test('ignores a former account response after account change', async () => {
  let resolveOld;
  mockGet.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  mockGet.mockRejectedValue({ response: { status: 403 } });
  const view = render(<StaffDashboardLink userId={1} />);
  view.rerender(<StaffDashboardLink userId={2} />);
  await act(async () => {
    resolveOld(session);
  });
  expect(screen.queryByRole('link')).toBeNull();
});

test('rechecks on focus and hides revoked access', async () => {
  mockGet
    .mockResolvedValueOnce(session)
    .mockRejectedValue({ response: { status: 403 } });
  render(<StaffDashboardLink userId={1} />);
  await screen.findByRole('link');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(screen.queryByRole('link')).toBeNull());
  expect(mockGet).toHaveBeenCalledTimes(2);
});
