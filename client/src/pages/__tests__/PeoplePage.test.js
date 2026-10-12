import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: { id: 1, username: 'julian' } }),
}));

jest.mock('@mantine/core', () => {
  const React = require('react');
  const Title = ({ children, ...p }) => React.createElement('div', p, children);
  const Group = ({ children, ...p }) => React.createElement('div', p, children);
  const Paper = ({ children, ...p }) => React.createElement('div', p, children);
  const Box = ({ children, ...p }) => React.createElement('div', p, children);
  const Stack = ({ children, ...p }) => React.createElement('div', p, children);
  const Text = ({ children, ...p }) => React.createElement('div', p, children);
  const Divider = ({ ...p }) => React.createElement('hr', p);
  const Loader = ({ ...p }) => React.createElement('div', { role: 'progressbar', ...p });
  const Alert = ({ children, ...p }) => React.createElement('div', { role: 'alert', ...p }, children);
  const Avatar = ({ children }) => React.createElement('div', null, children);

  const Button = ({ children, onClick, ...p }) =>
    React.createElement('button', { type: 'button', onClick, ...p }, children);

  const ActionIcon = ({ children, onClick, ...p }) =>
    React.createElement('button', { type: 'button', onClick, ...p }, children);

  const TextInput = ({ value, onChange, onKeyDown, placeholder, 'aria-label': aria, leftSection, rightSection, inputRef }) =>
    React.createElement(
      'label',
      null,
      React.createElement('input', {
        'aria-label': aria || placeholder,
        placeholder,
        value: value ?? '',
        onChange,
        onKeyDown,
        ref: inputRef,
      }),
      leftSection,
      rightSection
    );

  const Grid = ({ children, ...p }) => React.createElement('div', p, children);
  Grid.Col = ({ children, ...p }) => React.createElement('div', p, children);

  const CopyButton = ({ value, timeout = 1600, children }) => {
    const [copied, setCopied] = React.useState(false);
    const copy = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
      try { navigator.clipboard?.writeText?.(value); } catch {}
    };
    return children({ copied, copy });
  };

  const Tooltip = ({ children }) => React.createElement(React.Fragment, null, children);

  return {
    __esModule: true,
    Avatar,
    Title,
    Group,
    Button,
    Paper,
    TextInput,
    ActionIcon,
    Box,
    Grid,
    Stack,
    Text,
    Divider,
    CopyButton,
    Tooltip,
    Loader,
    Alert,
  };
});

jest.mock('@tabler/icons-react', () => {
  const React = require('react');
  const Icon = ({ 'data-name': name }) => React.createElement('span', null, name || 'icon');
  return {
    __esModule: true,
    IconSearch: Icon,
    IconX: Icon,
    IconCopy: Icon,
    IconCheck: Icon,
    IconDeviceMobile: Icon,
  };
});

jest.mock('../../components/ContactList', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ searchQuery }) =>
      React.createElement('div', { 'data-testid': 'contact-list', 'data-q': searchQuery ?? '' }, 'contacts'),
  };
});

jest.mock('@/components/ImportContactsModal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ opened }) =>
      opened ? React.createElement('div', { 'data-testid': 'import-modal' }, 'import-open') : null,
  };
});

jest.mock('@/components/AddContactModal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ opened }) =>
      opened ? React.createElement('div', { 'data-testid': 'add-contact-modal' }, 'add-contact-open') : null,
  };
});

import PeoplePage from '../PeoplePage';

const renderPage = () => render(<PeoplePage />);

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, '', '/people');
});

test('opens Import Contacts modal', () => {
  renderPage();
  expect(screen.queryByTestId('import-modal')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /import/i }));
  expect(screen.getByTestId('import-modal')).toBeInTheDocument();
});

test('search updates query and fetches Chatforia users', async () => {
  mockGet.mockResolvedValueOnce({ data: { items: [] } });
  renderPage();

  const input = screen.getByPlaceholderText(/search contacts or chatforia users/i);
  fireEvent.change(input, { target: { value: 'alice' } });
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

  expect(new URL(window.location.href).searchParams.get('q')).toBe('alice');
  expect(screen.getByTestId('contact-list')).toHaveAttribute('data-q', 'alice');
  await waitFor(() => {
    expect(mockGet).toHaveBeenCalledWith('/search/people', {
      params: { q: 'alice', limit: 12 },
    });
  });
});

test('renders duplicate names with distinct usernames and messages the selected userId', async () => {
  mockGet.mockResolvedValueOnce({
    data: {
      items: [
        { kind: 'user', id: 100, userId: 100, displayName: 'John Smith', username: 'johnsmith25' },
        { kind: 'user', id: 200, userId: 200, displayName: 'John Smith', username: 'johnsmithnyc' },
      ],
    },
  });
  mockPost.mockResolvedValueOnce({ data: { id: 77 } });
  window.history.replaceState({}, '', '/people?q=John%20Smith');

  renderPage();

  expect(await screen.findAllByText('John Smith')).toHaveLength(2);
  expect(screen.getByText('@johnsmith25')).toBeInTheDocument();
  expect(screen.getByText('@johnsmithnyc')).toBeInTheDocument();

  const messageButtons = screen.getAllByRole('button', { name: /message/i });
  fireEvent.click(messageButtons[1]);

  await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/chatrooms/direct/200'));
  expect(mockNavigate).toHaveBeenCalledWith('/chat/77');
});
