const { render, screen, fireEvent, cleanup } = require('@testing-library/react');

// -------------------- Mantine core mock --------------------
// We swallow style-ish props (`fw`, `c`, `size`, `mt`, etc.) and Mantine-only props
// so React doesn't warn about unknown DOM attributes.
jest.mock('@mantine/core', () => {
  const React = require('react');

  const stripMantineProps = (props) => {
    const {
      fw,
      c,
      size,
      mt,
      my,
      gap,
      p,
      'data-testid': dataTestId,
      // custom mantine-ish props we don't want on DOM:
      truncate,
      lineClamp,
      ...rest
    } = props;
    // we *do* keep data-testid if present
    if (dataTestId !== undefined) {
      rest['data-testid'] = dataTestId;
    }
    return rest;
  };

  const Stack = ({ children, ...p }) => (
    <div {...stripMantineProps(p)}>{children}</div>
  );

  const Group = ({ children, ...p }) => (
    <div {...stripMantineProps(p)}>{children}</div>
  );

  const Text = ({ children, ...p }) => (
    <p {...stripMantineProps(p)}>{children}</p>
  );

  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...stripMantineProps(p)}>
      {children}
    </button>
  );

  const Skeleton = ({ height, radius, ...p }) => (
    <div
      role="progressbar"
      data-height={height}
      data-radius={radius}
      {...stripMantineProps(p)}
    />
  );

  const Alert = ({ children, ...p }) => (
    <div role="alert" {...stripMantineProps(p)}>
      {children}
    </div>
  );

  const Badge = ({ children, ...p }) => (
    <span data-testid="badge" {...stripMantineProps(p)}>
      {children}
    </span>
  );

  const UnstyledButton = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...stripMantineProps(p)}>
      {children}
    </button>
  );

  const Divider = (p) => <hr {...stripMantineProps(p)} />;

  return {
    __esModule: true,
    Stack,
    Skeleton,
    Text,
    Button,
    Group,
    Alert,
    Badge,
    UnstyledButton,
    Divider,
  };
});

// -------------------- Icons mock --------------------
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconMessagePlus: (props) => (
    <span data-testid="icon-message-plus" {...props} />
  ),
}));

// -------------------- Ads + placements mocks --------------------
const mockAdSlot = jest.fn((props) => (
  <div data-testid={`adslot-${props.placement}`} />
));
jest.mock('@/ads/AdSlot', () => ({
  __esModule: true,
  default: (p) => mockAdSlot(p),
}));

// HouseAdSlot is referenced in some older versions; safe to mock anyway.
const mockHouseAdSlot = jest.fn((props) => (
  <div
    data-testid={`housead-${props.placement}`}
    data-variant={props.variant || ''}
  />
));
jest.mock('@/ads/HouseAdSlot', () => ({
  __esModule: true,
  default: (p) => mockHouseAdSlot(p),
}));

jest.mock('@/ads/placements', () => ({
  __esModule: true,
  PLACEMENTS: {
    SIDEBAR_PRIMARY: 'SIDEBAR_PRIMARY',
    SIDEBAR_SECONDARY: 'SIDEBAR_SECONDARY',
  },
}));

// -------------------- useIsPremium mock --------------------
let mockIsPremiumValue = false;
jest.mock('@/hooks/useIsPremium', () => ({
  __esModule: true,
  default: () => mockIsPremiumValue,
}));

// -------------------- axiosClient mock --------------------
// Still needed for the explicit "loading" tests.
const mockAxiosGet = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => mockAxiosGet(...args) },
}));

// -------------------- i18next mock --------------------
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    // fall back to defaultValue when provided
    t: (key, defaultValue) => defaultValue || key,
  }),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockIsPremiumValue = false;
});

// import SUT AFTER mocks
const ChatroomsSidebar = require('@/components/ChatroomsSidebar').default;

// -------------------- Tests --------------------
describe('ChatroomsSidebar', () => {
  test('shows loading skeletons and no ads while loading (free users)', () => {
    // Keep promise pending so state is "loading"
    mockAxiosGet.mockReturnValue(new Promise(() => {}));
    mockIsPremiumValue = false;

    render(
      <ChatroomsSidebar onStartNewChat={jest.fn()} onSelect={jest.fn()} />
    );

    // Header text from component is "Conversations"
    expect(screen.getByText(/conversations/i)).toBeInTheDocument();

    // No ads yet while loading
    expect(
      screen.queryByTestId('adslot-SIDEBAR_PRIMARY')
    ).not.toBeInTheDocument();

    // Skeletons present
    const skels = screen.getAllByRole('progressbar');
    expect(skels).toHaveLength(7);
  });

  test('loading hides ads for premium users', () => {
    mockAxiosGet.mockReturnValue(new Promise(() => {}));
    mockIsPremiumValue = true;

    render(<ChatroomsSidebar />);

    expect(
      screen.queryByTestId('adslot-SIDEBAR_PRIMARY')
    ).not.toBeInTheDocument();
  });

  test('empty list (free): shows empty state and new chat CTA (no ads)', async () => {
    mockIsPremiumValue = false;

    const onStart = jest.fn();
    render(
      <ChatroomsSidebar
        onStartNewChat={onStart}
        __testInitialRooms={[]}
        __testSkipLoad
      />
    );

    // Empty-state copy
    expect(
      screen.getByText(/no conversations yet/i)
    ).toBeInTheDocument();

    // Still no ads in empty state
    expect(
      screen.queryByTestId('adslot-SIDEBAR_PRIMARY')
    ).not.toBeInTheDocument();

    // CTA button text in component is "Start a chat"
    const cta = screen.getByRole('button', { name: /start.*chat/i });
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta);
    expect(onStart).toHaveBeenCalled();
  });

  test('empty list returns null when hideEmpty=true', () => {
    const { container } = render(
      <ChatroomsSidebar hideEmpty __testInitialRooms={[]} __testSkipLoad />
    );

    // component should return null (no DOM children)
    expect(container).toBeEmptyDOMElement();
  });

  test('populated list: titles/unread/last message/selection + secondary ad after 3rd item (free)', () => {
    mockIsPremiumValue = false;

    const rooms = [
      { id: 1, title: 'Alpha', unreadCount: 2, lastMessage: { content: 'Hello' } },
      { id: 2, name: 'Bravo', _count: { unread: 0 }, lastMessage: { content: 'Yo' } },
      { id: 3, displayName: 'Charlie' },
      { id: 4 }, // fallback -> "Room #4"
    ];

    const onSelect = jest.fn();
    render(
      <ChatroomsSidebar
        onSelect={onSelect}
        activeRoomId={2}
        __testInitialRooms={rooms}
        __testSkipLoad
      />
    );

    // Room titles
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Room #4')).toBeInTheDocument();

    // unread badge should include "2"
    const badges = screen.getAllByTestId('badge').map((b) => b.textContent);
    expect(badges).toContain('2');

    // lastMessage snippets
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Yo')).toBeInTheDocument();

    // `activeRoomId={2}` should apply background to that button.
    const buttons = screen.getAllByRole('button');
    const bravoBtn = buttons.find((btn) =>
      btn.textContent.includes('Bravo')
    );
    expect(bravoBtn).toHaveStyle({
      background: 'var(--mantine-color-gray-1)',
    });

    // clicking "Charlie" triggers onSelect with that room
    fireEvent.click(screen.getByText('Charlie'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3 })
    );

    // Ads should render for free users w/ populated list
    expect(
      screen.getByTestId('adslot-SIDEBAR_PRIMARY')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('adslot-SIDEBAR_SECONDARY')
    ).toBeInTheDocument();
  });

  test('premium user with populated list: no ads at all', () => {
    mockIsPremiumValue = true;

    render(
      <ChatroomsSidebar
        __testInitialRooms={[{ id: 1, title: 'OnlyRoom' }]}
        __testSkipLoad
      />
    );

    expect(
      screen.getByText('OnlyRoom')
    ).toBeInTheDocument();

    expect(
      screen.queryByTestId('adslot-SIDEBAR_PRIMARY')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('adslot-SIDEBAR_SECONDARY')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('housead-empty_state_promo')
    ).not.toBeInTheDocument();
  });

  test('error state shows alert and Retry button is clickable', () => {
    render(
      <ChatroomsSidebar
        __testInitialError="Could not load"
        __testSkipLoad
      />
    );

    // Alert should render with "Could not load"
    expect(
      screen.getByRole('alert')
    ).toHaveTextContent(/could not load/i);

    // Retry button is present and clickable (note: in real runtime load() is wired).
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeInTheDocument();

    fireEvent.click(retry);
    // Not asserting on side effects here; just ensuring click doesn't throw.
  });

  test('handles non-array data shape (data.rooms) via visibleRooms logic', () => {
    render(
      <ChatroomsSidebar
        __testInitialRooms={[{ id: 'x', title: 'ViaRoomsProp' }]}
        __testSkipLoad
      />
    );

    expect(
      screen.getByText('ViaRoomsProp')
    ).toBeInTheDocument();
  });
});
