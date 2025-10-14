import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '@/components/Sidebar';

// -------------------- Mocks --------------------

// Mantine core: light wrappers with a few conveniences
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Box = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Group = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Stack = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Divider = (p) => <hr {...p} />;

  const ActionIcon = ({ onClick, children, disabled, 'aria-label': aria, ...p }) => (
    <button type="button" aria-label={aria} onClick={onClick} disabled={disabled} {...p}>
      {children}
    </button>
  );

  // Button mock: when `component={Link}` we render an <a>, and we STRIP props
  // that React would warn about on DOM (<a>/<button>) such as `leftSection`.
  const Button = ({ children, onClick, component, to, 'aria-label': aria, leftSection, ...rest }) => {
    if (component && to) {
      // It's a link-like button
      return (
        <a href={to} aria-label={aria} data-button-link {...rest} onClick={onClick}>
          {children}
        </a>
      );
    }
    return (
      <button type="button" onClick={onClick} aria-label={aria} {...rest}>
        {children}
      </button>
    );
  };

  // ScrollArea.Autosize passthrough
  const ScrollAreaAutosize = ({ children, ...p }) => (
    <div data-testid="scrollarea" {...p}>{children}</div>
  );
  const ScrollArea = { Autosize: ScrollAreaAutosize };

  // Super-simple Drawer: show children when opened, expose an onClose hook via testid
  const Drawer = ({ opened, onClose, children, ...p }) =>
    opened ? (
      <div data-testid="drawer" data-opened="true" {...p}>
        <button aria-label="close-drawer" onClick={onClose} style={{ display: 'none' }} />
        {children}
      </div>
    ) : null;

  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;

  // Theme hook: breakpoints.sm needed by useMediaQuery
  const useMantineTheme = () => ({ breakpoints: { sm: '640px' } });

  return {
    Box, Group, ActionIcon, ScrollArea, Divider, Stack, Drawer, Text, Button, useMantineTheme,
  };
});

// Mantine hooks: control useMediaQuery via a mock function (names must start with "mock")
export const mockUseMediaQuery = jest.fn();
jest.mock('@mantine/hooks', () => ({
  useMediaQuery: (...args) => mockUseMediaQuery(...args),
}));

// Router: Link/NavLink + navigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...p }) => <a href={to} {...p}>{children}</a>,
  NavLink: ({ to, children, ...p }) => <a href={to} data-nav {...p}>{children}</a>,
  useNavigate: () => mockNavigate,
}));

// Icons (no-op)
jest.mock('lucide-react', () => {
  const I = (name) => (props) => <span data-icon={name} {...props} />;
  return {
    Plus: I('Plus'),
    Users: I('Users'),
    Settings: I('Settings'),
    PhoneForwarded: I('PhoneForwarded'),
    Dice5: I('Dice5'),
  };
});

// Children components
const mockStartChatModal = jest.fn((p) => (
  <div data-testid="start-chat-modal" data-user={p.currentUserId} />
));
jest.mock('@/components/StartChatModal', () => ({
  __esModule: true,
  default: (p) => mockStartChatModal(p),
}));

const mockChatroomsSidebar = jest.fn((p) => (
  <div data-testid="chatrooms-sidebar">
    <button onClick={p.onStartNewChat} aria-label="trigger-start-from-sidebar">
      open start modal
    </button>
  </div>
));
jest.mock('@/components/ChatroomsSidebar', () => ({
  __esModule: true,
  default: (p) => mockChatroomsSidebar(p),
}));

const mockUserProfile = jest.fn((p) => (
  <div data-testid="user-profile" data-open-section={p.openSection || ''} />
));
jest.mock('@/components/UserProfile', () => ({
  __esModule: true,
  default: (p) => mockUserProfile(p),
}));

// Ads + placements
const mockAdSlot = jest.fn((p) => <div data-testid={`adslot-${p.placement}`} />);
jest.mock('@/ads/AdSlot', () => ({ __esModule: true, default: (p) => mockAdSlot(p) }));
jest.mock('@/ads/placements', () => ({
  PLACEMENTS: { SIDEBAR_PRIMARY: 'SIDEBAR_PRIMARY' },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseMediaQuery.mockReturnValue(false); // default: desktop
  mockNavigate.mockClear();
});

// -------------------- Tests --------------------
describe('Sidebar', () => {
  test('top icons: Start disabled without user; Users navigates; Settings disabled without user', () => {
    render(<Sidebar currentUser={null} setSelectedRoom={jest.fn()} features={{}} />);

    const start = screen.getByRole('button', { name: /start chat/i });
    expect(start).toBeDisabled();

    // Users navigates to /people
    fireEvent.click(screen.getByRole('button', { name: /users/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/people');

    // Settings disabled without user
    expect(screen.getByRole('button', { name: /^settings$/i })).toBeDisabled();
  });

  test('opens StartChatModal via top icon and via ChatroomsSidebar onStartNewChat', () => {
    render(<Sidebar currentUser={{ id: 'me-1', plan: 'FREE' }} setSelectedRoom={jest.fn()} features={{}} />);

    // Top icon
    fireEvent.click(screen.getByRole('button', { name: /^start chat$/i }));
    expect(screen.getByTestId('start-chat-modal')).toBeInTheDocument();
    expect(screen.getByTestId('start-chat-modal').dataset.user).toBe('me-1');

    // Trigger via ChatroomsSidebar
    fireEvent.click(screen.getByRole('button', { name: /trigger-start-from-sidebar/i }));
    expect(screen.getAllByTestId('start-chat-modal').length).toBeGreaterThan(0);
  });

  test('quick links: Random Chat button only when logged in; Status only when features.status', () => {
    const { rerender } = render(
      <Sidebar currentUser={null} setSelectedRoom={() => {}} features={{ status: true }} />
    );
    // No Random Chat (requires currentUser)
    expect(screen.queryByText(/random chat/i)).not.toBeInTheDocument();
    // Status visible
    expect(screen.getByRole('link', { name: /status/i })).toHaveAttribute('href', '/status');

    rerender(
      <Sidebar currentUser={{ id: 'u1', plan: 'FREE' }} setSelectedRoom={() => {}} features={{ status: false }} />
    );
    // Random Chat renders as a LINK in our mock (component={Link})
    expect(screen.getByRole('link', { name: /open random chat/i })).toBeInTheDocument();
    // No Status link now
    expect(screen.queryByRole('link', { name: /status/i })).not.toBeInTheDocument();
  });

  test('open settings drawer (general) and forwarding section', () => {
    render(<Sidebar currentUser={{ id: 'me-2', plan: 'FREE' }} setSelectedRoom={() => {}} features={{}} />);

    // Use an exact match so we don't collide with "Open call and text forwarding settings"
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.getByTestId('user-profile').dataset.openSection).toBe('');

    // Close then open forwarding directly
    fireEvent.click(screen.getByLabelText('close-drawer'));

    fireEvent.click(screen.getByRole('button', { name: /open call and text forwarding settings/i }));
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.getByTestId('user-profile').dataset.openSection).toBe('forwarding');
  });

  test('desktop-only ad tile shows only when FREE and not mobile', () => {
    // Start FREE, desktop -> shows
    mockUseMediaQuery.mockReturnValue(false);
    const { rerender } = render(
      <Sidebar currentUser={{ id: 'u1', plan: 'FREE' }} setSelectedRoom={() => {}} features={{}} />
    );
    expect(screen.getByTestId('adslot-SIDEBAR_PRIMARY')).toBeInTheDocument();

    // Now PREMIUM -> no ad (reuse same render container)
    rerender(<Sidebar currentUser={{ id: 'u2', plan: 'PREMIUM' }} setSelectedRoom={() => {}} features={{}} />);
    expect(screen.queryByTestId('adslot-SIDEBAR_PRIMARY')).not.toBeInTheDocument();

    // FREE but mobile -> no ad
    mockUseMediaQuery.mockReturnValue(true);
    rerender(<Sidebar currentUser={{ id: 'u3', plan: 'FREE' }} setSelectedRoom={() => {}} features={{}} />);
    expect(screen.queryByTestId('adslot-SIDEBAR_PRIMARY')).not.toBeInTheDocument();
  });
});
