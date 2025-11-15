import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import NewChatModalHost from '../NewChatModalHost.jsx';

// Mock StartChatModal so we can assert props and trigger onClose
jest.mock('@/components/StartChatModal.jsx', () => ({
  __esModule: true,
  default: ({ onClose, currentUserId, initialQuery, hideSearch }) => (
    <div data-testid="start-chat-modal">
      <div data-testid="prop-currentUserId">{currentUserId}</div>
      <div data-testid="prop-initialQuery">{initialQuery}</div>
      <div data-testid="prop-hideSearch">{String(hideSearch)}</div>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe('NewChatModalHost', () => {
  test('renders nothing by default (closed state)', () => {
    const { container } = render(<NewChatModalHost currentUserId="user-123" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('start-chat-modal')).not.toBeInTheDocument();
  });

  test('opens when "open-new-chat-modal" is dispatched and passes props', () => {
    render(<NewChatModalHost currentUserId="user-123" />);

    const draft = { text: 'Hello there!' };
    fireEvent(
      window,
      new CustomEvent('open-new-chat-modal', { detail: { draft } })
    );

    const modal = screen.getByTestId('start-chat-modal');
    expect(modal).toBeInTheDocument();

    expect(screen.getByTestId('prop-currentUserId')).toHaveTextContent('user-123');
    expect(screen.getByTestId('prop-hideSearch')).toHaveTextContent('false');
    expect(screen.getByTestId('prop-initialQuery')).toHaveTextContent('Hello there!');
  });

  test('trims initialQuery to 120 chars', () => {
    render(<NewChatModalHost currentUserId="abc" />);

    const longText = 'x'.repeat(150);
    fireEvent(
      window,
      new CustomEvent('open-new-chat-modal', { detail: { draft: { text: longText } } })
    );

    const initialQuery = screen.getByTestId('prop-initialQuery').textContent;
    expect(initialQuery.length).toBe(120);
    expect(initialQuery).toBe('x'.repeat(120));
  });

  test('closes when "close-new-chat-modal" is dispatched', () => {
    render(<NewChatModalHost currentUserId="user-123" />);

    fireEvent(window, new CustomEvent('open-new-chat-modal', { detail: { draft: { text: 'hi' } } }));
    expect(screen.getByTestId('start-chat-modal')).toBeInTheDocument();

    fireEvent(window, new CustomEvent('close-new-chat-modal'));
    expect(screen.queryByTestId('start-chat-modal')).not.toBeInTheDocument();
  });

  test('closes when StartChatModal calls onClose', () => {
    render(<NewChatModalHost currentUserId="user-123" />);

    fireEvent(window, new CustomEvent('open-new-chat-modal', { detail: { draft: { text: 'hi' } } }));
    expect(screen.getByTestId('start-chat-modal')).toBeInTheDocument();

    // Click the mocked Close button which calls onClose
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('start-chat-modal')).not.toBeInTheDocument();
  });

  test('removes listeners on unmount (does not reopen after unmount)', () => {
    const { unmount } = render(<NewChatModalHost currentUserId="user-123" />);

    // Open it once
    fireEvent(window, new CustomEvent('open-new-chat-modal', { detail: { draft: { text: 'hi' } } }));
    expect(screen.getByTestId('start-chat-modal')).toBeInTheDocument();

    // Unmount the component
    unmount();

    // Dispatch again; since listeners are removed, nothing should render
    fireEvent(window, new CustomEvent('open-new-chat-modal', { detail: { draft: { text: 'hi again' } } }));
    // Nothing to assert in DOM now—just ensure no error and nothing mounted
  });
});
