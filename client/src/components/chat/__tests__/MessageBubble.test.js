import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import MessageBubble from '@/components/chat/MessageBubble';

// -------- Mocks --------

jest.mock('@mantine/core', () => {
  const React = require('react');

  const Box = ({ children, style, className, ...p }) => (
    <div style={style} className={className} {...p}>
      {children}
    </div>
  );

  const Group = ({ children, justify, ...p }) => (
    <div data-testid="group" data-justify={justify} {...p}>
      {children}
    </div>
  );

  const Text = ({ children, c, bg, style, ...p }) => (
    <p
      data-testid="text"
      data-c={c}
      data-bg={bg}
      role={p.role}
      aria-label={p['aria-label']}
      style={style}
    >
      {children}
    </p>
  );

  const ActionIcon = ({
    children,
    onClick,
    'aria-label': aria,
    title,
  }) => (
    <button
      type="button"
      aria-label={aria}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );

  const Tooltip = ({ label, children }) => (
    <div data-testid="tooltip" data-label={label}>
      {children}
    </div>
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

  return {
    __esModule: true,
    Box,
    Group,
    Text,
    ActionIcon,
    Tooltip,
    Menu,
  };
});

// Icons
jest.mock('lucide-react', () => ({
  RotateCw: (p) => <span data-testid="icon-rotate" {...p} />,
  MoreVertical: () => <span>more</span>,
  Pencil: () => <span>edit</span>,
  Trash2: () => <span>trash</span>,
  CalendarPlus: () => <span>calendar</span>,
  ShieldAlert: () => <span>report</span>,
  Copy: () => <span>copy</span>,
}));

// dayjs mock
const dayjsMock = (input) => ({
  format: () => `FMT(${input})`,
});

jest.mock('dayjs', () => dayjsMock);

// -------- Helpers --------

const baseMsg = {
  id: 'm1',
  content: 'Hello there',
  createdAt: '2024-08-15T12:34:56.000Z',
  senderId: 2,
  failed: false,
};

// -------- Tests --------

describe('MessageBubble', () => {
  test('renders message content with tooltip label and aria-label timestamp', () => {
    render(
      <MessageBubble
        msg={baseMsg}
        currentUserId={1}
      />
    );

    expect(screen.getByTestId('tooltip').dataset.label).toBe(
      'FMT(2024-08-15T12:34:56.000Z)'
    );

    expect(screen.getByText('Hello there')).toBeInTheDocument();

    const text = screen.getByTestId('text');

    expect(text).toHaveAttribute(
      'aria-label',
      'Message sent FMT(2024-08-15T12:34:56.000Z)'
    );
  });

  test('non-mine message aligns left and uses incoming bubble style', () => {
    const { container } = render(
      <MessageBubble
        msg={{ ...baseMsg, senderId: 2 }}
        currentUserId={1}
      />
    );

    const row = container.querySelector('.message-row');

    expect(row).toHaveStyle({
      justifyContent: 'flex-start',
    });

    const text = screen.getByTestId('text');

    expect(text).toHaveStyle({
      background: 'var(--bubble-incoming-bg, #f3f4f6)',
    });
  });

  test('mine message aligns right and uses outgoing bubble style', () => {
    const { container } = render(
      <MessageBubble
        msg={{ ...baseMsg, senderId: 1 }}
        currentUserId={1}
      />
    );

    const row = container.querySelector('.message-row');

    expect(row).toHaveStyle({
      justifyContent: 'flex-end',
    });

    const text = screen.getByTestId('text');

    expect(text).toHaveStyle({
      background: 'var(--bubble-outgoing, #f7a600)',
    });
  });

  test('shows retry button only when failed, and calls onRetry with msg', () => {
    const onRetry = jest.fn();

    const failedMsg = {
      ...baseMsg,
      failed: true,
    };

    const { rerender, queryByRole, getByRole } = render(
      <MessageBubble
        msg={failedMsg}
        currentUserId={1}
        onRetry={onRetry}
      />
    );

    const btn = getByRole('button', {
      name: /retry sending message/i,
    });

    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);

    expect(onRetry).toHaveBeenCalledWith(failedMsg);

    rerender(
      <MessageBubble
        msg={{ ...baseMsg, failed: false }}
        currentUserId={1}
        onRetry={onRetry}
      />
    );

    expect(
      queryByRole('button', {
        name: /retry sending message/i,
      })
    ).toBeNull();
  });

  test('shows message actions menu when actions are available', () => {
    render(
      <MessageBubble
        msg={{ ...baseMsg, senderId: 1 }}
        currentUserId={1}
        canEdit
        canDeleteAll
        onEdit={jest.fn()}
        onDeleteAll={jest.fn()}
      />
    );

    expect(screen.getByTestId('menu')).toBeInTheDocument();
    expect(screen.getByLabelText(/message actions/i)).toBeInTheDocument();
  });

  test('does not render empty placeholder attachment text', () => {
    render(
      <MessageBubble
        currentUserId={1}
        msg={{
          ...baseMsg,
          senderId: 2,
          content: '[image]',
          attachments: [
            {
              id: 'a1',
              url: 'https://example.com/test.jpg',
              mimeType: 'image/jpeg',
            },
          ],
        }}
      />
    );

    expect(screen.queryByText('[image]')).not.toBeInTheDocument();
    expect(screen.getByAltText(/attachment/i)).toBeInTheDocument();
  });
});