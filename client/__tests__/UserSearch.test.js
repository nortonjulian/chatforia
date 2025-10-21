import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import UserSearch from '../src/components/UserSearch';

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
  __esModule: true,
  IconSearch: (props) => <span data-testid="icon-search" {...props} />,
  IconSend: (props) => <span data-testid="icon-send" {...props} />,
}));

// axios client (mock by RESOLVED PATH so it matches the component's import)
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
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
    expect(mockGet).not.toHaveBeenCalled();

    // Whitespace
    typeQuery('   ');
    clickSearch();
    expect(mockGet).not.toHaveBeenCalled();
    // No "No user found" because guard short-circuits
    expect(screen.queryByText(/no user found/i)).not.toBeInTheDocument();
  });

  test('successful search: filters out current user, renders results list with phone and dividers', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);

    typeQuery('alice');
    // Resolve GET with 3 users (one = current user to be filtered)
    mockGet.mockResolvedValueOnce({
      data: [
        { id: 'me-1', username: 'Me' },
        { id: 'u-2', username: 'Alice', phoneNumber: '+1-555' },
        { id: 'u-3', username: 'Bob' },
      ],
    });

    clickSearch();

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/users/search?query=alice');
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
    mockGet.mockReturnValueOnce(pending);

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
    mockGet.mockRejectedValueOnce(new Error('boom'));
    clickSearch();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to fetch users. Please try again');
    expect(errorSpy).toHaveBeenCalledWith('Search error:', expect.any(Error));
  });

  test('Send button posts /chatrooms/direct and calls onNavigateToChatRoom', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);

    typeQuery('alice');
    mockGet.mockResolvedValueOnce({
      data: [
        { id: 'u-2', username: 'Alice' },
      ],
    });
    clickSearch();

    // Wait for list
    await screen.findByText('Alice');

    mockPost.mockResolvedValueOnce({ data: 'room-99' });

    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/chatrooms/direct', {
        userId1: 'me-1',
        userId2: 'u-2',
      });
    });

    expect(onNav).toHaveBeenCalledWith('room-99');
  });

  test('Send failure shows error alert', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);

    typeQuery('alice');
    mockGet.mockResolvedValueOnce({ data: [{ id: 'u-2', username: 'Alice' }] });
    clickSearch();
    await screen.findByText('Alice');

    mockPost.mockRejectedValueOnce(new Error('send fail'));

    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to start chat with this user.');
  });
});
