import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import MessageBubble from '@/components/chat/MessageBubble';
import axiosClient from '@/api/axiosClient';
jest.mock('@/api/axiosClient', () => ({ __esModule: true, default: { post: jest.fn() } }));

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

  const Text = ({ children, c, bg, style, component: Component = 'p', ...p }) => (
    <Component
      data-testid="text"
      data-c={c}
      data-bg={bg}
      role={p.role}
      aria-label={p['aria-label']}
      style={style}
    >
      {children}
    </Component>
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
// Show-original preference must affect the actual message bubble.
describe('original text with translation', () => {
  const translatedMessage = {
    ...baseMsg,
    id: 101,
    senderId: 2,
    decryptedContent: 'Hello, see you tomorrow',
    encryptedPayloadForMe: { encryptedKey: 'current-envelope' },
    decryptedOriginalKey: 'current-envelope',
    decryptedOriginalContent: 'Hola, nos vemos mañana',
  };

  test('shows both when enabled, hides original when disabled, and responds to changes', () => {
    const { rerender } = render(<MessageBubble msg={translatedMessage} currentUserId={1} showOriginalWithTranslation />);
    expect(screen.getByText('Hello, see you tomorrow')).toBeInTheDocument();
    expect(screen.getByText('Hola, nos vemos mañana')).toBeInTheDocument();
    rerender(<MessageBubble msg={translatedMessage} currentUserId={1} showOriginalWithTranslation={false} />);
    expect(screen.queryByText('Hola, nos vemos mañana')).not.toBeInTheDocument();
    expect(screen.getByText('Hello, see you tomorrow')).toBeInTheDocument();
    rerender(<MessageBubble msg={translatedMessage} currentUserId={1} showOriginalWithTranslation />);
    expect(screen.getByText('Hola, nos vemos mañana')).toBeInTheDocument();
  });

  test('does not expose deleted originals', () => {
    render(<MessageBubble msg={{ ...translatedMessage, deletedForAll: true }} currentUserId={1} showOriginalWithTranslation />);
    expect(screen.queryByText('Hola, nos vemos mañana')).not.toBeInTheDocument();
  });

  test('does not attach a cached original to a new message revision', () => {
    render(<MessageBubble msg={{ ...translatedMessage, editedAt: '2026-10-17T17:00:00Z', encryptedPayloadForMe: { encryptedKey: 'new-envelope' }, decryptedContent: 'Updated translation' }} currentUserId={1} showOriginalWithTranslation />);
    expect(screen.queryByText('Hola, nos vemos mañana')).not.toBeInTheDocument();
    expect(screen.getByText('Updated translation')).toBeInTheDocument();
  });

  test('does not add a second version to outgoing messages', () => {
    render(<MessageBubble msg={translatedMessage} currentUserId={2} showOriginalWithTranslation />);
    expect(screen.queryByText('Hola, nos vemos mañana')).not.toBeInTheDocument();
  });
});


describe('voice-note transcription in the actual message bubble', () => {
  const voice = { id: 10, senderId: 1, rawContent: '[voice note]', createdAt: '2026-10-18T00:00:00Z',
    attachments: [{ kind: 'AUDIO', mimeType: 'audio/mp4', url: 'https://media.example/a.m4a' }] };
  test('preserves one audio player and mounts one transcript for an enabled receiving account', async () => {
    axiosClient.post.mockResolvedValue({ data: { transcript: { segments: [{ text: 'Recorded words' }] } } });
    const { container } = render(<MessageBubble msg={voice} currentUserId={65} currentUser={{ id: 65, a11yVoiceNoteSTT: true }} />);
    expect(container.querySelectorAll('audio')).toHaveLength(1);
    expect(await screen.findByLabelText('Voice-note transcript')).toHaveTextContent('Recorded words');
    expect(screen.queryByText('[voice note]')).toBeNull();
  });
  test('a deleted voice note cannot mount the transcript or player', () => {
    axiosClient.post.mockClear();
    const { container } = render(<MessageBubble msg={{ ...voice, deletedForAll: true }} currentUserId={65} currentUser={{ id: 65, a11yVoiceNoteSTT: true }} />);
    expect(container.querySelector('audio')).toBeNull(); expect(axiosClient.post).not.toHaveBeenCalled();
  });
});
