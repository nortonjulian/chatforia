/** @jest-environment jsdom */

import React from 'react';
import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';

// ---- Mantine mock ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const cleanProps = (props = {}) => {
    const {
      children,
      gap,
      wrap,
      align,
      justify,
      radius,
      size,
      variant,
      withBorder,
      shadow,
      p,
      px,
      py,
      pt,
      pb,
      pl,
      pr,
      m,
      mx,
      my,
      mt,
      mb,
      ml,
      mr,
      w,
      maw,
      mih,
      c,
      fw,
      styles,
      autosize,
      minRows,
      maxRows,
      withinPortal,
      openDelay,
      ...rest
    } = props;

    return { children, rest };
  };

  const MantineProvider = ({ children }) => <>{children}</>;

  const Box = (props) => {
    const { children, rest } = cleanProps(props);
    return <div {...rest}>{children}</div>;
  };

  const Group = (props) => {
    const { children, rest } = cleanProps(props);
    return <div {...rest}>{children}</div>;
  };

  const Stack = (props) => {
    const { children, rest } = cleanProps(props);
    return <div {...rest}>{children}</div>;
  };

  const Paper = (props) => {
    const { children, rest } = cleanProps(props);
    return <div {...rest}>{children}</div>;
  };

  const mockCard = (props) => {
    const { children, rest } = cleanProps(props);
    return <div {...rest}>{children}</div>;
  };

  const mockBadge = (props) => {
    const { children, rest } = cleanProps(props);
    return <span {...rest}>{children}</span>;
  };

  const Text = (props) => {
    const { children, rest } = cleanProps(props);
    return <div {...rest}>{children}</div>;
  };

  const ActionIcon = ({
    children,
    onClick,
    disabled,
    type = 'button',
    ...props
  }) => {
    const { rest } = cleanProps(props);

    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        {...rest}
      >
        {children}
      </button>
    );
  };

  const Button = ({
    children,
    onClick,
    disabled,
    type = 'button',
    ...props
  }) => {
    const { rest } = cleanProps(props);

    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        {...rest}
      >
        {children}
      </button>
    );
  };

  const Tooltip = ({ children }) => <>{children}</>;

  const Textarea = ({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    ...props
  }) => {
    const { rest } = cleanProps(props);

    return (
      <textarea
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        {...rest}
      />
    );
  };

  const Select = ({
    value,
    onChange,
    data = [],
    disabled,
    ...props
  }) => {
    const { rest } = cleanProps(props);

    return (
      <select
        aria-label="Message timer"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        {...rest}
      >
        {data.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  };

  const Divider = () => <hr />;

  const Menu = ({ children }) => (
    <div data-testid="menu">{children}</div>
  );

  Menu.Target = ({ children }) => (
    <div data-testid="menu-target">{children}</div>
  );

  Menu.Dropdown = ({ children }) => (
    <div data-testid="menu-dropdown">{children}</div>
  );

  Menu.Item = ({ children, onClick }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );

  Menu.Label = ({ children }) => (
    <div data-testid="menu-label">{children}</div>
  );

  return {
    __esModule: true,
    MantineProvider,
    Box,
    Group,
    Stack,
    Paper,
    Card: mockCard,
    Badge: mockBadge,
    Text,
    ActionIcon,
    Button,
    Tooltip,
    Textarea,
    Menu,
    Divider,
    Select,
  };
});

// ---- Icons ----
jest.mock('@tabler/icons-react', () => {
  const Icon = () => <span data-testid="icon" />;

  return {
    __esModule: true,
    IconSend: Icon,
    IconPaperclip: Icon,
    IconClock: Icon,
  };
});

// ---- i18n ----
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, fallback) => fallback || _key,
  }),
}));

// ---- toast ----
jest.mock('../src/utils/toast', () => ({
  __esModule: true,
  toast: {
    ok: jest.fn(),
    err: jest.fn(),
    info: jest.fn(),
  },
}));

// ---- axios ----
const mockPost = jest.fn();

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...args) => mockPost(...args),
  },
}));

// ---- StickerPicker ----
jest.mock('../src/components/StickerPicker.jsx', () => ({
  __esModule: true,
  default: ({ opened, onPick }) =>
    opened ? (
      <button
        type="button"
        onClick={() =>
          onPick({
            kind: 'GIF',
            url: 'https://gif.example/test.gif',
          })
        }
      >
        Pick Sticker
      </button>
    ) : null,
}));

// ---- FileUploader ----
jest.mock('../src/components/FileUploader.jsx', () => ({
  __esModule: true,
  default: ({ onUploaded, button }) => (
    <div>
      {button}
      <button
        type="button"
        onClick={() =>
          onUploaded({
            key: 'uploads/test.png',
            url: 'https://cdn.example/test.png',
            contentType: 'image/png',
          })
        }
      >
        Mock Upload
      </button>
    </div>
  ),
}));

// ---- MicButton ----
jest.mock('../src/components/MicButton.jsx', () => ({
  __esModule: true,
  default: ({ onUploaded }) => (
    <button
      type="button"
      onClick={() =>
        onUploaded({
          key: 'voice/test.mp3',
          url: 'https://cdn.example/test.mp3',
          contentType: 'audio/mpeg',
        })
      }
    >
      Mock Mic
    </button>
  ),
}));

// ---- encryption loader ----
jest.mock('../src/utils/loadEncryptionClient', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    encryptForRoom: jest.fn(async () => ({
      ciphertext: 'encrypted',
      encryptedKeys: ['k1'],
      encryptionVersion: 1,
    })),
  })),
}));

// ---- uuid ----
jest.mock('uuid', () => ({
  __esModule: true,
  v4: () => 'uuid-123',
}));

import MessageInput from '../src/components/MessageInput.jsx';
import { renderWithRouter } from '../src/test-utils';
import { toast } from '../src/utils/toast';

beforeEach(() => {
  jest.clearAllMocks();
});

function renderComposer(extraProps = {}) {
  return renderWithRouter(
    <MessageInput
      chatroomId="room-1"
      currentUser={{
        id: 'u1',
        plan: 'FREE',
      }}
      roomParticipants={[]}
      onMessageSent={jest.fn()}
      {...extraProps}
    />
  );
}

test('disables send when nothing to send', () => {
  renderComposer();

  const sendBtn = screen.getByRole('button', { name: /send/i });

  expect(sendBtn).toBeDisabled();
});

test('sends trimmed text and calls onMessageSent', async () => {
  const onMessageSent = jest.fn();

  mockPost.mockResolvedValueOnce({
    data: {
      id: 'server-msg-1',
      content: 'hello world',
    },
  });

  renderComposer({ onMessageSent });

  const composer = screen.getByLabelText(/message composer/i);

  await userEvent.type(composer, '   hello world   ');

  const sendBtn = screen.getByRole('button', { name: /send/i });

  expect(sendBtn).toBeEnabled();

  await userEvent.click(sendBtn);

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  expect(mockPost).toHaveBeenCalledWith(
    '/messages',
    expect.objectContaining({
      clientMessageId: 'uuid-123',
      chatRoomId: 'room-1',
      content: 'hello world',
      attachmentsInline: [],
    }),
    {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    }
  );

  expect(onMessageSent).toHaveBeenCalled();

  expect(toast.ok).toHaveBeenCalledWith('Message delivered.');
});

test('adds a sticker inline and enables send', async () => {
  renderComposer();

  const sendBtn = screen.getByRole('button', { name: /send/i });

  expect(sendBtn).toBeDisabled();

  await userEvent.click(
    screen.getByRole('button', { name: /stickers & gifs/i })
  );

  await userEvent.click(screen.getByRole('button', { name: /pick sticker/i }));

  expect(sendBtn).toBeEnabled();

  expect(
    screen.getByTitle('https://gif.example/test.gif')
  ).toHaveTextContent('GIF');
});