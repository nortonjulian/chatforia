const { render, screen, fireEvent } = require('@testing-library/react');

// -------------------- Mantine core mock --------------------
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Box = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Group = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Stack = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Divider = (p) => <hr {...p} />;

  const ActionIcon = ({ onClick, children, disabled, 'aria-label': aria, ...p }) => (
    <button
      type="button"
      aria-label={aria}
      onClick={onClick}
      disabled={disabled}
      {...p}
    >
      {children}
    </button>
  );

  // Button mock:
  // - if component={Link} and `to` is passed, render <a>
  // - else render <button>
  const Button = ({
    children,
    onClick,
    component,
    to,
    'aria-label': aria,
    leftSection,
    ...rest
  }) => {
    if (component && to) {
      return (
        <a
          href={to}
          aria-label={aria}
          data-button-link
          onClick={onClick}
          {...rest}
        >
          {children}
        </a>
      );
    }
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={aria}
        {...rest}
      >
        {children}
      </button>
    );
  };

  // TextInput mock: plain <input />
  const TextInput = ({
    placeholder,
    value,
    onChange,
    'aria-label': aria,
    leftSection,
    ...rest
  }) => (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      aria-label={aria || placeholder}
      {...rest}
    />
  );

  // ScrollArea.Autosize passthrough
  const ScrollAreaAutosize = ({ children, ...p }) => (
    <div data-testid="scrollarea" {...p}>
      {children}
    </div>
  );
  const ScrollArea = { Autosize: ScrollAreaAutosize };

  // Drawer mock:
  // - only renders when `opened`
  // - includes a hidden close button we can target in tests
  const Drawer = ({ opened, onClose, children, ...p }) =>
    opened ? (
      <div data-testid="drawer" data-opened="true" {...p}>
        <button
          aria-label="close-drawer"
          onClick={onClose}
          style={{ display: 'none' }}
        />
        {children}
      </div>
    ) : null;

  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;

  // Theme hook for Sidebar -> isMobile breakpoint
  const useMantineTheme = () => ({ breakpoints: { sm: '640px' } });

  return {
    __esModule: true,
    Box,
    Group,
    ActionIcon,
    ScrollArea,
    Divider,
    Stack,
    Drawer,
    Text,
    Button,
    TextInput,
    useMantineTheme,
  };
});

// -------------------- Mantine hooks mock --------------------
const mockUseMediaQuery = jest.fn();
jest.mock('@mantine/hooks', () => ({
  __esModule: true,
  useMediaQuery: (...args) => mockUseMediaQuery(...args),
}));

// -------------------- react-router-dom mock --------------------
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ to, children, ...p }) => (
    <a href={to} {...p}>
      {children}
    </a>
  ),
  NavLink: ({ to, children, ...p }) => (
    <a href={to} data-nav {...p}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/' }),
}));

// -------------------- lucide-react mock --------------------
// -------------------- lucide-react mock --------------------
jest.mock('lucide-react', () => {
  const I = (name) => (props) => <span data-icon={name} {...props} />;
  return {
    __esModule: true,
    Plus: I('Plus'),
    Users: I('Users'),
    Settings: I('Settings'),
    PhoneForwarded: I('PhoneForwarded'),
    Dice5: I('Dice5'),
    RefreshCw: I('RefreshCw'),
    Search: I('Search'),
    // Add these three used by Sidebar.jsx:
    MessageSquare: I('MessageSquare'),
    Phone: I('Phone'),
    Video: I('Video'),
  };
});

// -------------------- Child component mocks --------------------
const mockStartChatModal = jest.fn((p) => (
  <div data-testid="start-chat-modal" data-user={p.currentUserId} />
));
jest.mock('@/components/StartChatModal', () => ({
  __esModule: true,
  default: (p) => mockStartChatModal(p),
}));

const mockChatroomsSidebar = jest.fn((p) => (
  <div data-testid="chatrooms-sidebar">
    <button
      onClick={p.onStartNewChat}
      aria-label="trigger-start-from-sidebar"
    >
      open start modal
    </button>
  </div>
));
jest.mock('@/components/ChatroomsSidebar', () => ({
  __esModule: true,
  default: (p) => mockChatroomsSidebar(p),
}));

const mockUserProfile = jest.fn((p) => (
  <div
    data-testid="user-profile"
    data-open-section={p.openSection || ''}
  />
));
jest.mock('@/components/UserProfile', () => ({
  __esModule: true,
  default: (p) => mockUserProfile(p),
}));

// -------------------- Ads mocks --------------------
const mockAdSlot = jest.fn((p) => (
  <div data-testid={`adslot-${p.placement}`} />
));
jest.mock('@/ads/AdSlot', () => ({
  __esModule: true,
  default: (p) => mockAdSlot(p),
}));
jest.mock('@/ads/placements', () => ({
  __esModule: true,
  PLACEMENTS: { SIDEBAR_PRIMARY: 'SIDEBAR_PRIMARY' },
}));

// -------------------- axiosClient virtual mock --------------------
// We mock it to avoid pulling in the real axiosClient (which may use Vite stuff).
jest.mock(
  '@/api/axiosClient',
  () => ({
    __esModule: true,
    default: {
      get: jest.fn().mockResolvedValue({ data: [] }),
      post: jest.fn().mockResolvedValue({ data: {} }),
      patch: jest.fn().mockResolvedValue({ data: {} }),
      delete: jest.fn().mockResolvedValue({ data: {} }),
    },
  }),
  { virtual: true }
);

// -------------------- SUT import --------------------
// Must come AFTER mocks.
const { default: Sidebar } = require('@/components/Sidebar');

// -------------------- Test setup --------------------
beforeEach(() => {
  jest.clearAllMocks();
  mockUseMediaQuery.mockReturnValue(false); // default to desktop
  mockNavigate.mockClear();
});

// -------------------- Tests --------------------
describe('Sidebar', () => {
  test('top icons: Start disabled without user; Users navigates; Settings disabled without user', () => {
    render(
      <Sidebar
        currentUser={null}
        setSelectedRoom={jest.fn()}
        features={{}}
      />
    );

    const start = screen.getByRole('button', { name: /start chat/i });
    expect(start).toBeDisabled();

    // Users navigates to /people
    fireEvent.click(screen.getByRole('button', { name: /people/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/people');

    // Settings disabled without user
    expect(
      screen.getByRole('button', { name: /^settings$/i })
    ).toBeDisabled();
  });

  test('opens StartChatModal via top icon and via ChatroomsSidebar onStartNewChat', () => {
    render(
      <Sidebar
        currentUser={{ id: 'me-1', plan: 'FREE' }}
        setSelectedRoom={jest.fn()}
        features={{}}
      />
    );

    // Top icon opens modal
    fireEvent.click(screen.getByRole('button', { name: /^start chat$/i }));
    expect(screen.getByTestId('start-chat-modal')).toBeInTheDocument();
    expect(screen.getByTestId('start-chat-modal').dataset.user).toBe('me-1');

    // Trigger via ChatroomsSidebar prop onStartNewChat
    fireEvent.click(
      screen.getByRole('button', { name: /trigger-start-from-sidebar/i })
    );
    // now we should still have at least one modal
    expect(
      screen.getAllByTestId('start-chat-modal').length
    ).toBeGreaterThan(0);
  });

  test('quick links: Random Chat button only when logged in; Status only when features.status', () => {
    const { rerender } = render(
      <Sidebar
        currentUser={null}
        setSelectedRoom={() => {}}
        features={{ status: true }}
      />
    );

    // No Random Chat (needs currentUser)
    expect(screen.queryByText(/random chat/i)).not.toBeInTheDocument();

    // Status visible when features.status = true
    // It's rendered as an <a> in our mock Button
    expect(
      screen.getByRole('link', { name: /status/i })
    ).toHaveAttribute('href', '/status');

    // Rerender with logged-in user and status=false
    rerender(
      <Sidebar
        currentUser={{ id: 'u1', plan: 'FREE' }}
        setSelectedRoom={() => {}}
        features={{ status: false }}
      />
    );

    // Random Chat visible now (Button -> <a/> w/ aria-label="Open Random Chat")
    expect(
      screen.getByRole('link', { name: /open random chat/i })
    ).toBeInTheDocument();

    // Status is gone (since features.status is false now)
    expect(
      screen.queryByRole('link', { name: /status/i })
    ).not.toBeInTheDocument();
  });

  test('open settings drawer (general) and forwarding section', () => {
    render(
      <Sidebar
        currentUser={{ id: 'me-2', plan: 'FREE' }}
        setSelectedRoom={() => {}}
        features={{}}
      />
    );

    // open general settings drawer from the "Settings" icon
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.getByTestId('user-profile').dataset.openSection).toBe('');

    // close drawer via hidden close button
    fireEvent.click(screen.getByLabelText('close-drawer'));

    // open forwarding section specifically using the "Call & Text Forwarding" button
    fireEvent.click(
      screen.getByRole('button', {
        name: /open call and text forwarding settings/i,
      })
    );

    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.getByTestId('user-profile').dataset.openSection).toBe(
      'forwarding'
    );
  });

  test('desktop-only ad tile shows only when FREE and not mobile', () => {
    // FREE plan on desktop -> ad visible
    mockUseMediaQuery.mockReturnValue(false);
    const { rerender } = render(
      <Sidebar
        currentUser={{ id: 'u1', plan: 'FREE' }}
        setSelectedRoom={() => {}}
        features={{}}
      />
    );
    expect(
      screen.getByTestId('adslot-SIDEBAR_PRIMARY')
    ).toBeInTheDocument();

    // PREMIUM plan on desktop -> no ad
    rerender(
      <Sidebar
        currentUser={{ id: 'u2', plan: 'PREMIUM' }}
        setSelectedRoom={() => {}}
        features={{}}
      />
    );
    expect(
      screen.queryByTestId('adslot-SIDEBAR_PRIMARY')
    ).not.toBeInTheDocument();

    // FREE plan but mobile -> no ad
    mockUseMediaQuery.mockReturnValue(true);
    rerender(
      <Sidebar
        currentUser={{ id: 'u3', plan: 'FREE' }}
        setSelectedRoom={() => {}}
        features={{}}
      />
    );
    expect(
      screen.queryByTestId('adslot-SIDEBAR_PRIMARY')
    ).not.toBeInTheDocument();
  });
});
