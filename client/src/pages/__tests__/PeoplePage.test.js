import { render, screen, fireEvent } from '@testing-library/react';

/* --- Keep axios out (avoids parsing import.meta) --- */
jest.mock('@/api/axiosClient', () => ({ __esModule: true, default: {} }));

/* --- Provide a fake user without importing the real context file --- */
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: { id: 1, username: 'julian' } }),
}));

/* --- Lightweight Mantine stubs (every named export PeoplePage uses) --- */
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Passthru = (tid) => ({ children, ...p }) =>
    React.createElement('div', { 'data-testid': tid, ...p }, children);

  const Title = ({ children, ...p }) => React.createElement('div', p, children);
  const Group = ({ children, ...p }) => React.createElement('div', p, children);
  const Paper = ({ children, ...p }) => React.createElement('div', p, children);
  const Box = ({ children, ...p }) => React.createElement('div', p, children);
  const Stack = ({ children, ...p }) => React.createElement('div', p, children);
  const Text = ({ children, ...p }) => React.createElement('div', p, children);
  const Divider = ({ ...p }) => React.createElement('hr', p);

  const Button = ({ children, onClick, ...p }) =>
    React.createElement('button', { type: 'button', onClick, ...p }, children);

  const ActionIcon = ({ children, onClick, ...p }) =>
    React.createElement('button', { type: 'button', onClick, ...p }, children);

  const TextInput = ({ value, onChange, placeholder, 'aria-label': aria, leftSection, rightSection, inputRef, ...p }) =>
    React.createElement(
      'label',
      null,
      React.createElement('input', {
        'aria-label': aria || placeholder,
        placeholder,
        value: value ?? '',
        onChange,
        ref: inputRef,
      }),
      leftSection,
      rightSection
    );

  // Very simple grid with a namespaced Col
  const Grid = ({ children, ...p }) => React.createElement('div', p, children);
  Grid.Col = ({ children, ...p }) => React.createElement('div', p, children);

  // CopyButton provides render-prop API used by the page
  const CopyButton = ({ value, timeout = 1600, children }) => {
    const [copied, setCopied] = React.useState(false);
    const copy = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
      try { navigator.clipboard?.writeText?.(value); } catch {}
    };
    return children({ copied, copy });
  };

  // Tooltip just renders children
  const Tooltip = ({ children }) => React.createElement(React.Fragment, null, children);

  return {
    __esModule: true,
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
  };
});

/* --- Tabler icons as harmless spans --- */
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

/* --- Children components mocked on the exact paths PeoplePage uses --- */
jest.mock('../../components/StartChatModal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ onClose }) =>
      React.createElement('div', { 'data-testid': 'startchat-modal', onClick: onClose }, 'startchat'),
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

// PeoplePage imports this via alias
jest.mock('@/components/ImportContactsModal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ opened }) =>
      opened ? React.createElement('div', { 'data-testid': 'import-modal' }, 'import-open') : null,
  };
});

/* --- SUT --- */
import PeoplePage from '../PeoplePage';

const renderPage = () => render(<PeoplePage />);

test('opens Import Contacts modal', () => {
  renderPage();

  // Closed initially
  expect(screen.queryByTestId('import-modal')).toBeNull();

  // Button on the right-side "Quick start" card
  fireEvent.click(screen.getByRole('button', { name: /import/i }));

  expect(screen.getByTestId('import-modal')).toBeInTheDocument();
});

test('search input updates query param on Search', () => {
  renderPage();

  // Global search input (its placeholder text comes from PeoplePage)
  const input = screen.getByPlaceholderText(/search by alias, name, username, or phone/i);

  fireEvent.change(input, { target: { value: 'alice' } });
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

  const q = new URL(window.location.href).searchParams.get('q');
  expect(q).toBe('alice');

  // Also passed as prop to ContactList
  expect(screen.getByTestId('contact-list')).toHaveAttribute('data-q', 'alice');
});
