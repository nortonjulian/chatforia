import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import UserSearch from '../src/components/UserSearch';

jest.mock('@mantine/core', () => {
  const React = require('react');
  const Paper = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Title = ({ children, ...p }) => <h3 {...p}>{children}</h3>;
  const TextInput = ({ value, onChange, onKeyDown, placeholder, leftSection, className, style }) => (
    <div>
      {leftSection}
      <input
        aria-label={placeholder || 'input'}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
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
  const Avatar = ({ children }) => <div>{children}</div>;
  return { Paper, Title, TextInput, Button, Stack, Group, Text, Loader, Alert, Divider, Avatar };
});

jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconSearch: (props) => <span data-testid="icon-search" {...props} />,
  IconSend: (props) => <span data-testid="icon-send" {...props} />,
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
const me = { id: 1, username: 'Me' };
const onNav = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function typeQuery(val) {
  const input = screen.getByLabelText(/name or username/i);
  fireEvent.change(input, { target: { value: val } });
  return input;
}

function clickSearch() {
  fireEvent.click(screen.getByRole('button', { name: /search/i }));
}

describe('UserSearch', () => {
  test('does nothing on empty or whitespace-only query', () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);
    clickSearch();
    expect(mockGet).not.toHaveBeenCalled();

    typeQuery('   ');
    clickSearch();
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('requires at least 3 characters', () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);
    typeQuery('Jo');
    clickSearch();
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter at least 3 characters');
  });

  test('renders duplicate display names with distinct usernames', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);
    typeQuery('John Smith');
    mockGet.mockResolvedValueOnce({
      data: {
        items: [
          { kind: 'user', id: 100, userId: 100, displayName: 'John Smith', username: 'johnsmith25' },
          { kind: 'user', id: 200, userId: 200, displayName: 'John Smith', username: 'johnsmithnyc' },
        ],
      },
    });

    clickSearch();

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/search/people', {
        params: { q: 'John Smith', limit: 12 },
      });
    });

    expect(screen.getAllByText('John Smith')).toHaveLength(2);
    expect(screen.getByText('@johnsmith25')).toBeInTheDocument();
    expect(screen.getByText('@johnsmithnyc')).toBeInTheDocument();
  });

  test('Send targets the selected userId', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);
    typeQuery('John Smith');
    mockGet.mockResolvedValueOnce({
      data: {
        items: [
          { kind: 'user', id: 200, userId: 200, displayName: 'John Smith', username: 'johnsmithnyc' },
        ],
      },
    });
    clickSearch();
    await screen.findByText('@johnsmithnyc');

    mockPost.mockResolvedValueOnce({ data: { id: 99 } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/chatrooms/direct/200');
    });
    expect(onNav).toHaveBeenCalledWith(99);
  });

  test('search error shows alert message', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);
    typeQuery('error');
    mockGet.mockRejectedValueOnce(new Error('boom'));
    clickSearch();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to fetch users. Please try again');
    expect(errorSpy).toHaveBeenCalledWith('Search error:', expect.any(Error));
  });

  test('Send failure shows an error', async () => {
    render(<UserSearch currentUser={me} onNavigateToChatRoom={onNav} />);
    typeQuery('alice');
    mockGet.mockResolvedValueOnce({
      data: { items: [{ kind: 'user', id: 2, userId: 2, displayName: 'Alice', username: 'alice' }] },
    });
    clickSearch();
    await screen.findByText('@alice');

    mockPost.mockRejectedValueOnce(new Error('send fail'));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to start chat with this user.');
  });
});
