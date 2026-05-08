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

function makeResponse(overrides = {}) {
  return {
    data: {
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
    },
  };
}

describe('AdminVoiceLogsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches and renders voice logs on mount', async () => {
    axiosClient.get.mockResolvedValueOnce(makeResponse());

    render(<AdminVoiceLogsPage />);

    expect(await screen.findByText('+15551111111')).toBeInTheDocument();
    expect(screen.getByText('+14443332222')).toBeInTheDocument();

    expect(axiosClient.get).toHaveBeenCalledWith(
      '/admin/voice-logs',
      expect.objectContaining({
        params: expect.objectContaining({
          status: '',
          direction: '',
          phone: '',
          take: 50,
          skip: 0,
        }),
      })
    );
  });

  it('shows an error message when loading fails', async () => {
    axiosClient.get.mockRejectedValueOnce(new Error('Network error'));

    render(<AdminVoiceLogsPage />);

    expect(await screen.findByText(/failed to load voice logs/i)).toBeInTheDocument();
  });

  it('applies phone filter and refetches logs', async () => {
    const user = userEvent.setup();

    axiosClient.get
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(
        makeResponse({
          id: 'log-2',
          from: '+15555555555',
          to: '+19998887777',
        })
      );

    render(<AdminVoiceLogsPage />);

    await screen.findByText('+15551111111');

    const phoneInput = screen.getByPlaceholderText(/phone contains/i);

    await user.clear(phoneInput);
    await user.type(phoneInput, '555');

    await user.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(axiosClient.get).toHaveBeenCalledTimes(2);
    });

    expect(axiosClient.get.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({
          phone: '555',
          take: 50,
          skip: 0,
        }),
      })
    );

    expect(await screen.findByText('+15555555555')).toBeInTheDocument();
    expect(screen.getByText('+19998887777')).toBeInTheDocument();
  });
});