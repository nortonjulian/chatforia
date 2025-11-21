import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DirectVideo from '../DirectVideo.jsx';

/* ------------ Mocks ------------ */

const mockStartCall = jest.fn();

jest.mock('@/context/CallContext', () => ({
  __esModule: true,
  useCall: () => ({
    startCall: mockStartCall,
  }),
}));

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

// Simple i18n mock: return defaultValue if provided, otherwise the key
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, defaultValue) => defaultValue ?? key,
  }),
}));

import axiosClient from '@/api/axiosClient';

/* ------------ Helpers ------------ */

const renderWithUser = (props = {}) =>
  render(<DirectVideo currentUser={{ id: 1, name: 'Caller' }} {...props} />);

/* ------------ Tests ------------ */

describe('DirectVideo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders headers and sections when showHeader=true', () => {
    renderWithUser({ showHeader: true });

    expect(screen.getByText(/Direct Video/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Start a 1:1 video call using a phone number or Chatforia username/i)
    ).toBeInTheDocument();

    expect(screen.getByText(/Call by phone/i)).toBeInTheDocument();
    expect(screen.getByText(/Find a user/i)).toBeInTheDocument();
  });

  test('phone: disables Call button when no user or no phone, enables otherwise and calls backend', async () => {
    renderWithUser();

    const input = screen.getByLabelText(/Phone to call/i);
    const btn = screen.getByRole('button', { name: /Call/i });

    // Initially disabled (no phone)
    expect(btn).toBeDisabled();

    // Enter phone, button becomes enabled
    fireEvent.change(input, { target: { value: '+1-555-123-4567' } });
    expect(btn).toBeEnabled();

    // Backend returns calleeId so we start a direct call
    axiosClient.post.mockResolvedValueOnce({
      data: { calleeId: 99 },
    });

    fireEvent.click(btn);

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledWith('/calls/start-by-phone', {
        phone: '+1-555-123-4567',
        mode: 'VIDEO',
      });
      expect(mockStartCall).toHaveBeenCalledWith({ calleeId: 99, mode: 'VIDEO' });
    });
  });

  test('phone: if backend returns inviteCode, calls navigateToJoin with inviteCode', async () => {
    const navigateToJoin = jest.fn();

    renderWithUser({ navigateToJoin });

    const input = screen.getByLabelText(/Phone to call/i);
    const btn = screen.getByRole('button', { name: /Call/i });

    fireEvent.change(input, { target: { value: '+1-555-999-0000' } });

    axiosClient.post.mockResolvedValueOnce({
      data: { inviteCode: 'join-abc' },
    });

    fireEvent.click(btn);

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledWith('/calls/start-by-phone', {
        phone: '+1-555-999-0000',
        mode: 'VIDEO',
      });
      expect(navigateToJoin).toHaveBeenCalledWith('join-abc');
    });
  });

  test('searches people and shows results, then calls startCall on "Call"', async () => {
    renderWithUser();

    const searchInput = screen.getByLabelText(/Search by name or username/i);
    const searchBtn = screen.getByRole('button', { name: /Search/i });

    axiosClient.get.mockResolvedValueOnce({
      data: [
        { id: 101, name: 'Alice', username: 'alice' },
        { id: 102, name: 'Bob', username: 'bob' },
      ],
    });

    // Type query and click Search
    fireEvent.change(searchInput, { target: { value: 'a' } });
    fireEvent.click(searchBtn);

    // Wait for results
    await screen.findByText('Alice');
    await screen.findByText('Bob');

    // We have multiple "Call" buttons:
    // - the phone Call button
    // - one per result
    const callButtons = screen.getAllByRole('button', { name: /Call/i });
    expect(callButtons.length).toBeGreaterThanOrEqual(2);

    // Click the last Call button, which corresponds to the last result (Bob, id 102)
    fireEvent.click(callButtons[callButtons.length - 1]);

    expect(mockStartCall).toHaveBeenCalledTimes(1);
    expect(mockStartCall).toHaveBeenCalledWith({ calleeId: 102, mode: 'VIDEO' });
  });

  test('handles API error and shows no search results (only the phone Call remains)', async () => {
    renderWithUser();

    const searchInput = screen.getByLabelText(/Search by name or username/i);
    const searchBtn = screen.getByRole('button', { name: /Search/i });

    axiosClient.get.mockRejectedValueOnce(new Error('Search failed'));

    fireEvent.change(searchInput, { target: { value: 'x' } });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      // No result name / username text should be present
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
      expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    });

    // We intentionally do NOT assert about "Call" buttons here, since the
    // phone Call button still exists.
  });

  test('renders without header when showHeader=false', () => {
    renderWithUser({ showHeader: false });

    // Title text should be absent
    expect(screen.queryByText(/Direct Video/i)).not.toBeInTheDocument();

    // But the sections still exist
    expect(screen.getByText(/Call by phone/i)).toBeInTheDocument();
    expect(screen.getByText(/Find a user/i)).toBeInTheDocument();
  });
});
