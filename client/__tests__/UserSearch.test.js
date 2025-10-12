import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import UserSearch from '@/components/UserSearch'; // adjust path if needed

// -------- Mocks --------

// Mantine components -> lightweight HTML stand-ins
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Paper = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Title = ({ children, ...p }) => <h3 {...p}>{children}</h3>;
  const TextInput = ({ value, onChange, placeholder, leftSection, className, style }) => (
    <div>
      {leftSection}
      <input
        aria-label={placeholder || 'input'}
        value={value}
        onChange={onChange}
        className={className}
        style={style}
      />
    </div>
  );
  const Button = ({ children, onClick, loading, ...p }) => (
    <button type="button" onClick={onClick} data-loading={!!loading} {...p}>
      {children}
    </button>
  );
  const Stack = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Group = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;
  const Loader = (p) => <div role="progressbar" {...p} />;
  const Alert = ({ children, ...p }) => <div role="alert" {...p}>{children}</div>;
  const Divider = (p) => <hr {...p} />;
  return { Paper, Title, TextInput, Button, Stack, Group, Text, Loader, Alert, Divider };
});

// Icons (not relevant to behavior)
jest.mock('@tabler/icons-react', () => ({
  IconSearch: (props) => <span data-testid="icon-search" {...props} />,
  IconSend: (props) => <span data-testid="icon-send" {...props} />,
}));

// axios client
const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('@/components/../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => getMock(...args),
    post: (...args) => postMock(...args),
  },
}));

// Silence expected error logs so test output is clean
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

const me = { id: 'me-1', username: 'Me' };
const onNav = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function typeQuery(val) {
  const input = screen.getByLabelText(/username or phone number/i);
  fireEvent.change(input, { target: { value: val } });
  return input;
}

function clickSearch() {
  fireEvent.click(screen.getByRole('button', { name: /search/i }));
}

describe('UserSearch', () => {
  test('does nothing on empty or whitespace-only query', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);
    // Empty
    clickSearch();
    expect(getMock).not.toHaveBeenCalled();

    // Whitespace
    typeQuery('   ');
    clickSearch();
    expect(getMock).not.toHaveBeenCalled();
    // Also shows no result message only when query present AND not loading & no error; query was whitespace then cleared to empty by guard
    expect(screen.queryByText(/no user found/i)).not.toBeInTheDocument();
  });

  test('successful search: filters out current user, renders results list with phone and dividers', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);

    typeQuery('alice');
    // Resolve GET with 3 users (one = current user to be filtered)
    getMock.mockResolvedValueOnce({
      data: [
        { id: 'me-1', username: 'Me' },
        { id: 'u-2', username: 'Alice', phoneNumber: '+1-555' },
        { id: 'u-3', username: 'Bob' },
      ],
    });

    clickSearch();

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/users/search?query=alice');
    });

    // Should render Alice and Bob, not Me
    expect(screen.queryByText(/^Me$/)).not.toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('+1-555')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();

    // Two results -> one Divider between them
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  test('loading shows loader; when 0 results and query present, shows "No user found"', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);

    typeQuery('nobody');
    // Keep promise pending briefly to assert loading
    let resolve;
    const pending = new Promise((r) => (resolve = r));
    getMock.mockReturnValueOnce(pending);

    clickSearch();

    // Loader shown during pending
    expect(screen.getByRole('button', { name: /search/i })).toHaveAttribute('data-loading', 'true');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // Resolve with empty array
    resolve({ data: [] });

    await waitFor(() => {
      expect(screen.getByText(/no user found/i)).toBeInTheDocument();
    });
  });

  test('search error shows alert message', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);

    typeQuery('err');
    getMock.mockRejectedValueOnce(new Error('boom'));
    clickSearch();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to fetch users. Please try again');
    expect(errorSpy).toHaveBeenCalledWith('Search error:', expect.any(Error));
  });

  test('Send button posts /chatrooms/direct and calls onNavigateToChatRoom', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);

    typeQuery('alice');
    getMock.mockResolvedValueOnce({
      data: [
        { id: 'u-2', username: 'Alice' },
      ],
    });
    clickSearch();

    // Wait for list
    await screen.findByText('Alice');

    postMock.mockResolvedValueOnce({ data: 'room-99' });

    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/chatrooms/direct', {
        userId1: 'me-1',
        userId2: 'u-2',
      });
    });

    expect(onNav).toHaveBeenCalledWith('room-99');
  });

  test('Send failure shows error alert', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);

    typeQuery('alice');
    getMock.mockResolvedValueOnce({ data: [{ id: 'u-2', username: 'Alice' }] });
    clickSearch();
    await screen.findByText('Alice');

    postMock.mockRejectedValueOnce(new Error('send fail'));

    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to start chat with this user.');
  });
});
