import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ---- Mantine minimal stubs (safe) ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );
  const Button = ({ children, onClick, ...rest }) => (
    <button onClick={onClick} {...rest}>{children}</button>
  );
  const Text = ({ children, ...rest }) => <div {...rest}>{children}</div>;
  const Badge = ({ children, ...rest }) => <span {...rest}>{children}</span>;
  return {
    __esModule: true,
    Card: passthru('card'),
    Stack: passthru('stack'),
    Group: passthru('group'),
    Text,
    Button,
    Badge,
  };
});

// ---- Router (prefix with "mock" so Jest allows usage in factory) ----
const mockNavigate = jest.fn();
let mockRouteCode = 'abc123';
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
  useParams: () => ({ code: mockRouteCode }),
}));

// ---- User context (use a "mock*" var so the factory can reference it) ----
let mockCurrentUser = null;
jest.mock('../../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: mockCurrentUser }),
}));

// ---- Axios client (use mock* names inside the factory) ----
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
  },
}));

// ---- SUT ----
import JoinInvitePage from '../JoinInvitePage.jsx';

describe('JoinInvitePage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockGet.mockReset();
    mockPost.mockReset();
    mockCurrentUser = null;
    mockRouteCode = 'abc123';
  });

  test('shows loading then invalid when GET fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('nope'));

    render(<JoinInvitePage />);

    expect(screen.getByText(/Loading…/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/invites/abc123');
      expect(screen.getByText(/Invite link/i)).toBeInTheDocument();
      expect(screen.getByText(/invalid/i)).toBeInTheDocument();
      expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
    });
  });

  test('shows invalid card when status is not ok', async () => {
    mockGet.mockResolvedValueOnce({ data: { status: 'expired' } });

    render(<JoinInvitePage />);

    await waitFor(() => {
      expect(screen.getByText(/Invite link/i)).toBeInTheDocument();
      expect(screen.getByText(/expired/i)).toBeInTheDocument();
    });
  });

  test('valid invite + not logged in: clicking Join redirects to login with next', async () => {
    mockGet.mockResolvedValueOnce({ data: { status: 'ok', roomName: 'Room X' } });
    mockCurrentUser = null;

    render(<JoinInvitePage />);

    await waitFor(() => screen.getByText(/Join “Room X”/i));
    fireEvent.click(screen.getByText(/Join chat/i));

    expect(mockNavigate).toHaveBeenCalledWith('/?next=/join/abc123');
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('valid invite + logged in: accepts and navigates to room', async () => {
    mockGet.mockResolvedValueOnce({ data: { status: 'ok', roomName: 'General' } });
    mockPost.mockResolvedValueOnce({ data: { roomId: 'r-789' } });
    mockCurrentUser = { id: 7 };

    render(<JoinInvitePage />);

    await waitFor(() => screen.getByText(/Join “General”/i));
    fireEvent.click(screen.getByText(/Join chat/i));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/invites/abc123/accept');
      expect(mockNavigate).toHaveBeenCalledWith('/chat/r-789');
    });
  });

  test('uses the route param code dynamically', async () => {
    mockRouteCode = 'zzz999';
    mockGet.mockResolvedValueOnce({ data: { status: 'ok', roomName: 'Dyn' } });
    mockCurrentUser = null;

    render(<JoinInvitePage />);

    await waitFor(() => screen.getByText(/Join “Dyn”/i));
    fireEvent.click(screen.getByText(/Join chat/i));
    expect(mockNavigate).toHaveBeenCalledWith('/?next=/join/zzz999');
  });
});
