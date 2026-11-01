import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
// Jest resolves Mantine compound components differently from Vite.
jest.mock('@mantine/core', () => {
  const actual = jest.requireActual('@mantine/core');

  return {
    ...actual,
    Grid: Object.assign(
      (props) => <actual.Grid {...props} />,
      { Col: actual.GridCol }
    ),
    List: Object.assign(
      (props) => <actual.List {...props} />,
      { Item: actual.ListItem }
    ),
  };
});

import Advertise from '../Advertise';

const mockOpenEmailDraft = jest.fn();

jest.mock('@/utils/openAdvertisingEmailDraft', () => ({
  openAdvertisingEmailDraft: (...args) => mockOpenEmailDraft(...args),
}));

const mockPost = jest.fn();
const mockToastOk = jest.fn();
const mockToastInfo = jest.fn();
const mockToastErr = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...args) => mockPost(...args),
  },
}));

jest.mock('@/utils/toast', () => ({
  toast: {
    ok: (...args) => mockToastOk(...args),
    info: (...args) => mockToastInfo(...args),
    err: (...args) => mockToastErr(...args),
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback) => fallback || _key,
  }),
}));

jest.mock('@/ads/placements', () => ({
  PLACEMENTS: {},
}));

function renderPage() {
  return render(
    <MantineProvider>
      <Advertise />
    </MantineProvider>
  );
}

function fillForm() {

  fireEvent.change(screen.getByPlaceholderText('Jane Doe'), {
    target: { value: 'Test Advertiser' },
  });

  fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
    target: { value: 'advertiser@example.com' },
  });

  fireEvent.change(screen.getByPlaceholderText('Targeting, dates, KPIs, placement preferences…'), {
    target: { value: 'Testing advertising inquiry.' },
  });
}

describe('Advertise inquiry submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('successful API request displays confirmation', async () => {
    mockPost.mockResolvedValueOnce({ data: { ok: true, id: 42 } });

    renderPage();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: 'Send inquiry' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/ads/inquiries',
        expect.objectContaining({
          name: 'Test Advertiser',
          email: 'advertiser@example.com',
        })
      );
    });

    expect(await screen.findByText(/Your inquiry is on its way/i))
      .toBeInTheDocument();

    expect(mockToastOk).toHaveBeenCalled();
  });

  test('failed API request does not display submission confirmation', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network unavailable'));

    renderPage();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: 'Send inquiry' }));

    await waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalled();
    });

    expect(screen.queryByText(/Your inquiry is on its way/i))
      .not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Send inquiry' }))
      .toBeInTheDocument();

    expect(mockOpenEmailDraft).toHaveBeenCalledTimes(1);
    expect(mockOpenEmailDraft.mock.calls[0][0])
      .toContain('mailto:ads@chatforia.com?');

    expect(mockToastOk).not.toHaveBeenCalled();
  });
});
