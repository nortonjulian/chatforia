import { render, screen } from '@testing-library/react';
import ChatHome from '../src/components/ChatHome.jsx';

jest.mock('../src/components/chat/ChatHeaderActions.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="chat-header-actions" />,
}));

test('renders children', () => {
  render(
    <ChatHome currentUser={{ id: 1 }}>
      <div>Chat content</div>
    </ChatHome>
  );

  expect(screen.getByText(/chat content/i)).toBeInTheDocument();
});

test('renders conversation header when peerUser is provided', () => {
  render(
    <ChatHome currentUser={{ id: 1 }} peerUser={{ id: 2, username: 'alice' }} />
  );

  expect(screen.getByText('alice')).toBeInTheDocument();
  expect(screen.getByTestId('chat-header-actions')).toBeInTheDocument();
});