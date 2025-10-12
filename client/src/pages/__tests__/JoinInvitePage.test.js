import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ---- Mocks ----

// Mantine minimal stubs
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

// Router
const navigateMock = jest.fn();
let routeCode = 'abc123';
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => navigateMock,
  useParams: () => ({ code: routeCode }),
}));

// User context
let currentUserVal = null;
jest.mock('../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: currentUserVal }),
}));

// Axios client
const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => getMock(...a),
    post: (...a) => postMock(...a),
  },
}));

// SUT
import JoinInvitePage from './JoinInvitePage';

describe('JoinInvitePage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getMock.mockReset();
    postMock.mockReset();
    currentUserVal = null;
    routeCode = 'abc123';
  });

  test('shows loading then invalid when GET fails', async () => {
    getMock.mockRejectedValueOnce(new Error('nope'));

    render(<JoinInvitePage />);

    expect(screen.getByText(/Loading…/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/invites/abc123');
      expect(screen.getByText(/Invite link/i)).toBeInTheDocument();
      expect(screen.getByText(/invalid/i)).toBeInTheDocument();
      expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
    });
  });

  test('shows invalid card when status is not ok', async () => {
    getMock.mockResolvedValueOnce({ data: { status: 'expired' } });

    render(<JoinInvitePage />);

    await waitFor(() => {
      expect(screen.getByText(/Invite link/i)).toBeInTheDocument();
      expect(screen.getByText(/expired/i)).toBeInTheDocument();
    });
  });

  test('valid invite + not logged in: clicking Join redirects to login with next', async () => {
    getMock.mockResolvedValueOnce({ data: { status: 'ok', roomName: 'Room X' } });
    currentUserVal = null; // not logged in

    render(<JoinInvitePage />);

    await waitFor(() => screen.getByText(/Join “Room X”/i));
    fireEvent.click(screen.getByText(/Join chat/i));

    expect(navigateMock).toHaveBeenCalledWith('/?next=/join/abc123');
    expect(postMock).not.toHaveBeenCalled();
  });

  test('valid invite + logged in: accepts and navigates to room', async () => {
    getMock.mockResolvedValueOnce({ data: { status: 'ok', roomName: 'General' } });
    postMock.mockResolvedValueOnce({ data: { roomId: 'r-789' } });
    currentUserVal = { id: 7 };

    render(<JoinInvitePage />);

    await waitFor(() => screen.getByText(/Join “General”/i));
    fireEvent.click(screen.getByText(/Join chat/i));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/invites/abc123/accept');
      expect(navigateMock).toHaveBeenCalledWith('/chat/r-789');
    });
  });

  test('uses the route param code dynamically', async () => {
    routeCode = 'zzz999';
    getMock.mockResolvedValueOnce({ data: { status: 'ok', roomName: 'Dyn' } });
    currentUserVal = null;

    render(<JoinInvitePage />);

    await waitFor(() => screen.getByText(/Join “Dyn”/i));
    fireEvent.click(screen.getByText(/Join chat/i));
    expect(navigateMock).toHaveBeenCalledWith('/?next=/join/zzz999');
  });
});
