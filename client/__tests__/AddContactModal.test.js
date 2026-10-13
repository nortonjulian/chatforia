import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AddContactModal from '@/components/AddContactModal';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

jest.mock('@mantine/core', () => {
  const React = require('react');

  const Modal = ({ opened, children }) =>
    opened ? React.createElement('div', null, children) : null;

  const Stack = ({ children }) => React.createElement('div', null, children);
  const Group = ({ children }) => React.createElement('div', null, children);
  const Paper = ({ children, onClick }) =>
    React.createElement('div', { onClick }, children);
  const Text = ({ children }) => React.createElement('span', null, children);
  const Avatar = ({ children }) => React.createElement('div', null, children);

  const TextInput = ({ label, value, onChange, placeholder }) =>
    React.createElement('input', {
      'aria-label': label || placeholder,
      value: value ?? '',
      onChange,
      placeholder,
    });

  const Button = ({ children, onClick, disabled, loading }) =>
    React.createElement(
      'button',
      {
        type: 'button',
        onClick,
        disabled: disabled || loading,
      },
      children
    );

  return {
    __esModule: true,
    Avatar,
    Button,
    Group,
    Modal,
    Paper,
    Stack,
    Text,
    TextInput,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('same-name users require explicit selection and save the selected userId', async () => {
  mockGet.mockResolvedValueOnce({
    data: {
      items: [
        {
          kind: 'user',
          id: 100,
          userId: 100,
          displayName: 'John Smith',
          username: 'johnsmith25',
        },
        {
          kind: 'user',
          id: 200,
          userId: 200,
          displayName: 'John Smith',
          username: 'johnsmithnyc',
        },
      ],
    },
  });
  mockPost.mockResolvedValueOnce({ data: { id: 55 } });

  render(
    <AddContactModal
      opened
      currentUserId={999}
      onClose={jest.fn()}
      onAdded={jest.fn()}
    />
  );

  fireEvent.change(screen.getByLabelText(/phone, name, or username/i), {
    target: { value: 'John Smith' },
  });

  await waitFor(
    () => {
      expect(mockGet).toHaveBeenCalledWith('/search/people', {
        params: { q: 'John Smith', limit: 12 },
      });
    },
    { timeout: 1000 }
  );

  expect(await screen.findAllByText('John Smith')).toHaveLength(2);
  expect(screen.getByText('@johnsmith25')).toBeInTheDocument();
  expect(screen.getByText('@johnsmithnyc')).toBeInTheDocument();

  const addButton = screen.getByRole('button', { name: /^add$/i });
  expect(addButton).toBeDisabled();

  fireEvent.click(screen.getByText('@johnsmithnyc'));
  expect(addButton).not.toBeDisabled();

  fireEvent.click(addButton);

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith('/contacts', {
      alias: null,
      userId: 200,
    });
  });

  expect(mockGet).not.toHaveBeenCalledWith(
    '/users/lookup',
    expect.anything()
  );
});

test('phone-number contacts remain direct and do not require account search', async () => {
  mockPost.mockResolvedValueOnce({ data: { id: 56 } });

  render(
    <AddContactModal
      opened
      currentUserId={999}
      onClose={jest.fn()}
      onAdded={jest.fn()}
    />
  );

  fireEvent.change(screen.getByLabelText(/phone, name, or username/i), {
    target: { value: '+1 202 555 0147' },
  });

  const addButton = screen.getByRole('button', { name: /^add$/i });
  expect(addButton).not.toBeDisabled();
  fireEvent.click(addButton);

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith('/contacts', {
      alias: null,
      externalPhone: '+1 202 555 0147',
    });
  });

  expect(mockGet).not.toHaveBeenCalled();
});
