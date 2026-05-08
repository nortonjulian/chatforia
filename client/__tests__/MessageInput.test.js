/** @jest-environment jsdom */

import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils.js';

// ---- Mantine mocks ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const cleanProps = (props = {}) => {
    const {
      children,
      autosize,
      withBorder,
      radius,
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
      gap,
      spacing,
      fw,
      c,
      variant,
      size,
      justify,
      align,
      wrap,
      grow,
      styles,
      sx,
      ...rest
    } = props;

    return { children, rest };
  };

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

  const Text = (props) => {
    const { children, rest } = cleanProps(props);
    return <span {...rest}>{children}</span>;
  };

  const ActionIcon = ({
    children,
    onClick,
    'aria-label': ariaLabel,
    ...props
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );

  const Button = ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
    type = 'button',
    ...props
  }) => (
    <button
      type={type}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );

  const Tooltip = ({ children }) => <>{children}</>;

  const Textarea = ({
    value,
    onChange,
    placeholder,
    'aria-label': ariaLabel,
    onKeyDown,
    ...props
  }) => (
    <textarea
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      {...props}
    />
  );

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

  const Divider = (props) => <hr data-testid="divider" {...props} />;

  const Select = ({
    value,
    onChange,
    data = [],
    'aria-label': ariaLabel,
    ...props
  }) => (
    <select
      data-testid="select"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      {...props}
    >
      {data.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );

  return {
    __esModule: true,
    Box,
    Group,
    Stack,
    Paper,
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

// ---- toast mock ----
jest.mock('../src/utils/toast', () => ({
  __esModule: true,
  toast: {
    ok: jest.fn(),
    err: jest.fn(),
    info: jest.fn(),
  },
}));

// ---- i18n mock ----
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

// ---- uuid mock ----
jest.mock('uuid', () => ({
  __esModule: true,
  v4: () => 'client-message-1',
}));

// ---- encryption mock ----
jest.mock('../src/utils/loadEncryptionClient', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    encryptForRoom: jest.fn(async () => ({
      ciphertext: 'encrypted-text',
      encryptedKeys: [],
      encryptionVersion: 1,
    })),
  })),
}));

// ---- axios mock ----
const mockPost = jest.fn();

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...args) => mockPost(...args),
  },
}));

// ---- StickerPicker mock ----
jest.mock('../src/components/StickerPicker.jsx', () => ({
  __esModule: true,
  default: ({ opened, onPick, onClose }) =>
    opened ? (
      <button
        type="button"
        onClick={() => {
          onPick({ kind: 'STICKER', url: 'http://s' });
          onClose();
        }}
      >
        PickSticker
      </button>
    ) : null,
}));

// ---- FileUploader mock ----
jest.mock('../src/components/FileUploader.jsx', () => ({
  __esModule: true,
  default: ({ button }) => <>{button}</>,
}));

// ---- MicButton mock ----
jest.mock('../src/components/MicButton.jsx', () => ({
  __esModule: true,
  default: () => (
    <button type="button" aria-label="Voice note">
      Mic
    </button>
  ),
}));

// ---- icon mocks ----
jest.mock('@tabler/icons-react', () => {
  const React = require('react');

  return {
    __esModule: true,
    IconSend: (props) => <svg data-testid="icon-send" {...props} />,
    IconPaperclip: (props) => (
      <svg data-testid="icon-paperclip" {...props} />
    ),
    IconClock: (props) => <svg data-testid="icon-clock" {...props} />,
  };
});

// ---- SUT ----
import MessageInput from '../src/components/MessageInput.jsx';

beforeEach(() => {
  jest.clearAllMocks();
});

test('disables send when nothing to send', () => {
  renderWithRouter(
    <MessageInput
      chatroomId={123}
      currentUser={{}}
      onMessageSent={() => {}}
    />
  );

  expect(
    screen.getByRole('button', { name: /send/i })
  ).toBeDisabled();
});

test('sends trimmed text and calls onMessageSent', async () => {
  const user = userEvent.setup();

  const saved = {
    id: 9,
    content: 'hi',
  };

  mockPost.mockResolvedValueOnce({
    data: saved,
  });

  const onMessageSent = jest.fn();

  renderWithRouter(
    <MessageInput
      chatroomId={5}
      currentUser={{}}
      onMessageSent={onMessageSent}
    />
  );

  await user.type(
    screen.getByLabelText(/message composer/i),
    '  hi  '
  );

  await user.click(
    screen.getByRole('button', { name: /send/i })
  );

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith(
      '/messages',
      expect.objectContaining({
        clientMessageId: 'client-message-1',
        chatRoomId: '5',
        expireSeconds: 0,
        content: 'hi',
        attachmentsInline: [],
      }),
      expect.objectContaining({
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      })
    );
  });

  expect(onMessageSent).toHaveBeenCalledWith(
    expect.objectContaining({
      clientMessageId: 'client-message-1',
      content: 'hi',
      optimistic: true,
    })
  );

  expect(onMessageSent).toHaveBeenCalledWith(saved);
});

test('adds a sticker inline and enables send', async () => {
  const user = userEvent.setup();

  mockPost.mockResolvedValueOnce({
    data: { id: 1 },
  });

  renderWithRouter(
    <MessageInput
      chatroomId={7}
      currentUser={{}}
      onMessageSent={() => {}}
    />
  );

  await user.click(
    screen.getByRole('button', { name: /emoji/i })
  );

  await user.click(
    screen.getByRole('button', { name: /picksticker/i })
  );

  const send = screen.getByRole('button', {
    name: /send/i,
  });

  expect(send).not.toBeDisabled();

  await user.click(send);

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith(
      '/messages',
      expect.objectContaining({
        chatRoomId: '7',
        content: undefined,
        attachmentsInline: [
          expect.objectContaining({
            kind: 'IMAGE',
            url: 'http://s',
          }),
        ],
      }),
      expect.any(Object)
    );
  });
});