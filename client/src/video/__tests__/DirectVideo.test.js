/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// SUT
import DirectVideo from '@/video/DirectVideo.jsx';

// Mocks
const getMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => getMock(...args) },
}));

const useCallMock = jest.fn();
const startCallMock = jest.fn();
jest.mock('@/context/CallContext', () => ({
  __esModule: true,
  useCall: () => useCallMock(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useCallMock.mockReturnValue({ startCall: startCallMock });
});

describe('DirectVideo', () => {
  test('renders and disables Search when not logged in', () => {
    render(<DirectVideo currentUser={null} />);

    // Static text present
    expect(
      screen.getByText(/Start a direct 1:1 video call/i)
    ).toBeInTheDocument();

    // Input present
    expect(
      screen.getByLabelText(/Find a user/i)
    ).toBeInTheDocument();

    // Search button disabled when currentUser is falsy
    const searchBtn = screen.getByRole('button', { name: /search/i });
    expect(searchBtn).toBeDisabled();
  });

  test('searches people and shows results, then calls startCall on "Call"', async () => {
    const results = [
      { id: 101, name: 'Alice Example', username: 'alice' },
      { id: 202, username: 'bob' }, // no name, should fall back to username
    ];
    getMock.mockResolvedValueOnce({ data: results });

    render(<DirectVideo currentUser={{ id: 'me' }} />);

    // Type query
    const input = screen.getByLabelText(/Find a user/i);
    fireEvent.change(input, { target: { value: 'ali' } });

    // Click Search
    const searchBtn = screen.getByRole('button', { name: /search/i });
    expect(searchBtn).not.toBeDisabled();
    fireEvent.click(searchBtn);

    // Verify axios called with correct params
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/people', { params: { q: 'ali' } });
    });

    // Results rendered
    expect(await screen.findByText('Alice Example')).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();

    // Click "Call" for Alice
    const aliceRow = screen.getByText('Alice Example').closest('div');
    const callButtons = screen.getAllByRole('button', { name: /call/i });
    // Choose the first "Call" (Alice)
    fireEvent.click(callButtons[0]);

    expect(startCallMock).toHaveBeenCalledTimes(1);
    expect(startCallMock).toHaveBeenCalledWith({ calleeId: 101, mode: 'VIDEO' });
  });

  test('does not issue request when query is empty/whitespace', async () => {
    render(<DirectVideo currentUser={{ id: 'me' }} />);

    const input = screen.getByLabelText(/Find a user/i);
    fireEvent.change(input, { target: { value: '   ' } });

    const searchBtn = screen.getByRole('button', { name: /search/i });
    fireEvent.click(searchBtn);

    // No axios call should happen
    await new Promise((r) => setTimeout(r, 50));
    expect(getMock).not.toHaveBeenCalled();
  });

  test('handles API error and shows no results', async () => {
    getMock.mockRejectedValueOnce(new Error('network'));
    render(<DirectVideo currentUser={{ id: 'me' }} />);

    const input = screen.getByLabelText(/Find a user/i);
    fireEvent.change(input, { target: { value: 'char' } });

    const searchBtn = screen.getByRole('button', { name: /search/i });
    fireEvent.click(searchBtn);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    // Should not render any user rows
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /call/i })).not.toBeInTheDocument();
  });

  test('accepts initialPeerId without crashing', () => {
    render(<DirectVideo currentUser={{ id: 'me' }} initialPeerId="999" />);
    // No behavior yet—this just ensures it renders and effect runs
    expect(
      screen.getByText(/Start a direct 1:1 video call/i)
    ).toBeInTheDocument();
  });
});
