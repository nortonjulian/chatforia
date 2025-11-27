import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminVoiceLogsPage from '../AdminVoiceLogsPage.jsx';
import axiosClient from '../../api/axiosClient';

jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

function setupSuccessResponse(overrides = {}) {
  const data = {
    items: [
      {
        id: 'log-1',
        from: '+15551111111',
        to: '+14443332222',
        direction: 'outbound',
        status: 'COMPLETED',
        timestamp: '2025-01-01T00:00:00.000Z',
        ...overrides,
      },
    ],
    total: 1,
  };

  axiosClient.get.mockResolvedValueOnce({ data });
  return data;
}

describe('AdminVoiceLogsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches and renders voice logs on mount', async () => {
    const data = setupSuccessResponse();

    render(<AdminVoiceLogsPage />);

    // Optional: if you have an explicit loading indicator/text
    // expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Wait for the data to appear
    expect(await screen.findByText('+15551111111')).toBeInTheDocument();
    expect(screen.getByText('+14443332222')).toBeInTheDocument();

    // basic sanity on the API call
    expect(axiosClient.get).toHaveBeenCalledTimes(1);
    expect(axiosClient.get).toHaveBeenCalledWith(
      '/admin/voice-logs',
      expect.objectContaining({
        params: expect.any(Object),
      })
    );

    // You can also assert that total count or table header is rendered if you have it:
    // expect(screen.getByText(/total/i)).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    axiosClient.get.mockRejectedValueOnce(new Error('Network error'));

    render(<AdminVoiceLogsPage />);

    // Adjust this text to whatever your Alert / error text actually is
    const error = await screen.findByText(/failed to load/i);
    expect(error).toBeInTheDocument();
  });

  it('applies phone filter and refetches logs', async () => {
    const user = userEvent.setup();

    // First load
    setupSuccessResponse();
    // Second load (after filter)
    setupSuccessResponse({
      id: 'log-2',
      from: '+15555555555',
      to: '+19998887777',
    });

    render(<AdminVoiceLogsPage />);

    // Wait for initial data
    await screen.findByText('+15551111111');

    // Type into phone filter input
    // 🔧 Adjust placeholder / label to match your component
    const phoneInput =
      screen.queryByPlaceholderText(/phone/i) ||
      screen.queryByPlaceholderText(/search/i);

    expect(phoneInput).toBeInTheDocument();

    await user.clear(phoneInput);
    await user.type(phoneInput, '555');

    // Click the filter/apply button
    // 🔧 Adjust the button text to your actual label
    const applyButton =
      screen.queryByRole('button', { name: /apply/i }) ||
      screen.queryByRole('button', { name: /filter/i });

    expect(applyButton).toBeInTheDocument();
    await user.click(applyButton);

    // Second request should be made with phone param
    await waitFor(() => {
      expect(axiosClient.get).toHaveBeenCalledTimes(2);
    });

    const secondCallArgs = axiosClient.get.mock.calls[1][1];
    expect(secondCallArgs).toHaveProperty('params');
    expect(secondCallArgs.params).toEqual(
      expect.objectContaining({
        phone: '555',
      })
    );

    // New result should be visible
    expect(await screen.findByText('+15555555555')).toBeInTheDocument();
  });

  it('supports changing pagination (take/skip) if your UI exposes it', async () => {
    const user = userEvent.setup();

    // First load
    setupSuccessResponse();
    // Second load after pagination change
    setupSuccessResponse({
      id: 'log-3',
      from: '+17778889999',
    });

    render(<AdminVoiceLogsPage />);

    await screen.findByText('+15551111111');

    // 🔧 Adjust selectors to match your page:
    // e.g., a Select / NumberInput labeled "Per page" or "Rows"
    const perPageInput =
      screen.queryByLabelText(/per page/i) ||
      screen.queryByLabelText(/rows/i);

    if (!perPageInput) {
      // If you don't have pagination controls yet, you can safely
      // delete this entire test.
      return;
    }

    await user.clear(perPageInput);
    await user.type(perPageInput, '100');

    // Might need to click Apply if your UI requires it
    const applyButton =
      screen.queryByRole('button', { name: /apply/i }) ||
      screen.queryByRole('button', { name: /update/i });

    if (applyButton) {
      await user.click(applyButton);
    }

    await waitFor(() => {
      expect(axiosClient.get).toHaveBeenCalledTimes(2);
    });

    const secondCallArgs = axiosClient.get.mock.calls[1][1];
    expect(secondCallArgs.params).toEqual(
      expect.objectContaining({
        take: 100,
      })
    );
  });
});
