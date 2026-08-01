import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DirectVideo from '../DirectVideo.jsx';

const mockStartCall = jest.fn();

jest.mock('@/context/CallContext', () => ({
  __esModule: true,
  useCall: () => ({ startCall: mockStartCall }),
}));

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback) => fallback || _key,
  }),
}));

import axiosClient from '@/api/axiosClient';

const renderWithUser = (props = {}) =>
  render(<DirectVideo currentUser={{ id: 1, name: 'Caller' }} {...props} />);

describe('DirectVideo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders the current header and user-search interface', () => {
    renderWithUser();

    expect(screen.getByRole('heading', { name: 'Direct Video' })).toBeInTheDocument();
    expect(screen.getByText(/another Chatforia user/i)).toBeInTheDocument();
    expect(screen.getByText('Find a Chatforia user')).toBeInTheDocument();
    expect(screen.getByLabelText('Search by name or username')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  test('searches contacts and users, deduplicates them, and starts a video call', async () => {
    axiosClient.get
      .mockResolvedValueOnce({
        data: [{ id: 10, alias: 'Alice Contact', userId: 101 }],
      })
      .mockResolvedValueOnce({
        data: [
          { id: 101, name: 'Alice', username: 'alice' },
          { id: 102, name: 'Bob', username: 'bob' },
          { id: 1, name: 'Caller', username: 'caller' },
        ],
      });

    renderWithUser();
    fireEvent.change(screen.getByLabelText('Search by name or username'), {
      target: { value: 'a' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Alice Contact')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Caller')).not.toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();

    const callButtons = screen.getAllByRole('button', { name: 'Call' });
    fireEvent.click(callButtons[1]);

    expect(mockStartCall).toHaveBeenCalledWith({
      calleeId: 102,
      mode: 'VIDEO',
      peerName: 'Bob',
    });
  });

  test('handles search failures without rendering results', async () => {
    axiosClient.get.mockRejectedValue(new Error('Search failed'));

    renderWithUser();
    fireEvent.change(screen.getByLabelText('Search by name or username'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(axiosClient.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument();
  });

  test('starts an initial deep-linked call once', async () => {
    const { rerender } = render(
      <DirectVideo currentUser={{ id: 1 }} initialPeerId="123" />
    );

    await waitFor(() => {
      expect(mockStartCall).toHaveBeenCalledWith({ calleeId: 123, mode: 'VIDEO' });
    });

    rerender(<DirectVideo currentUser={{ id: 1 }} initialPeerId="123" />);
    expect(mockStartCall).toHaveBeenCalledTimes(1);
  });

  test('hides only the header when showHeader is false', () => {
    renderWithUser({ showHeader: false });

    expect(screen.queryByRole('heading', { name: 'Direct Video' })).not.toBeInTheDocument();
    expect(screen.getByText('Find a Chatforia user')).toBeInTheDocument();
  });
});
