import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ChatroomsSidebar from '@/components/ChatroomsSidebar'; // <-- adjust path if needed

// -------------------- Mocks --------------------

// Mantine primitives
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Noop = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;
  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );
  const Skeleton = ({ height, radius, ...p }) => (
    <div role="progressbar" data-height={height} data-radius={radius} {...p} />
  );
  const UnstyledButton = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );
  const Badge = ({ children, ...p }) => <span data-testid="badge" {...p}>{children}</span>;
  const Alert = ({ children, ...p }) => <div role="alert" {...p}>{children}</div>;
  const Divider = (p) => <hr {...p} />;
  return {
    Stack: Noop,
    Skeleton,
    Text,
    Button,
    Group: Noop,
    Alert,
    Badge,
    UnstyledButton,
    Divider,
  };
});

// Icon
jest.mock('@tabler/icons-react', () => ({
  IconMessagePlus: (props) => <span data-testid="icon-message-plus" {...props} />,
}));

// Ads + placements
const AdSlot = jest.fn((props) => <div data-testid={`adslot-${props.placement}`} />);
const HouseAdSlot = jest.fn((props) => (
  <div data-testid={`housead-${props.placement}`} data-variant={props.variant || ''} />
));
jest.mock('@/ads/AdSlot', () => ({ __esModule: true, default: (p) => AdSlot(p) }));
jest.mock('@/ads/HouseAdSlot', () => ({ __esModule: true, default: (p) => HouseAdSlot(p) }));
jest.mock('@/ads/placements', () => ({
  PLACEMENTS: {
    SIDEBAR_PRIMARY: 'SIDEBAR_PRIMARY',
    SIDEBAR_SECONDARY: 'SIDEBAR_SECONDARY',
  },
}));

// Premium hook
let isPremiumValue = false;
jest.mock('@/hooks/useIsPremium', () => ({
  __esModule: true,
  default: () => isPremiumValue,
}));

// axios client
const axiosGet = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => axiosGet(...args) },
}));

// window.location.reload
const reloadSpy = jest.fn();
const originalLocation = window.location;

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: reloadSpy },
  });
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  isPremiumValue = false;
});

// -------------------- Helpers --------------------
function resolveRooms(data) {
  axiosGet.mockResolvedValue({ data });
}
function rejectRooms(err) {
  const error = err instanceof Error ? err : new Error(err?.message || 'Boom');
  if (err && typeof err === 'object') error.response = err.response;
  axiosGet.mockRejectedValue(error);
}

// -------------------- Tests --------------------
describe('ChatroomsSidebar', () => {
  test('shows loading skeletons and primary ad for free users', () => {
    // keep promise pending so we stay in loading state
    axiosGet.mockReturnValue(new Promise(() => {}));
    isPremiumValue = false;

    render(<ChatroomsSidebar onStartNewChat={jest.fn()} onSelect={jest.fn()} />);

    // Header
    expect(screen.getByText(/chatrooms/i)).toBeInTheDocument();

    // Primary ad visible (free)
    expect(screen.getByTestId('adslot-SIDEBAR_PRIMARY')).toBeInTheDocument();

    // Skeletons present (7)
    const skels = screen.getAllByRole('progressbar');
    expect(skels).toHaveLength(7);
  });

  test('loading hides ads for premium users', () => {
    axiosGet.mockReturnValue(new Promise(() => {}));
    isPremiumValue = true;

    render(<ChatroomsSidebar />);

    expect(screen.queryByTestId('adslot-SIDEBAR_PRIMARY')).not.toBeInTheDocument();
  });

  test('empty list (free): shows empty state, new chat CTA, primary ad + house promo', async () => {
    isPremiumValue = false;
    resolveRooms([]); // backend may return [] directly

    const onStart = jest.fn();
    render(<ChatroomsSidebar onStartNewChat={onStart} />);

    // Wait to exit loading
    expect(await screen.findByText(/no conversations yet/i)).toBeInTheDocument();

    // Primary ad visible
    expect(screen.getByTestId('adslot-SIDEBAR_PRIMARY')).toBeInTheDocument();

    // CTA
    const cta = screen.getByRole('button', { name: /new chat/i });
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta);
    expect(onStart).toHaveBeenCalled();

    // House promo under CTA
    expect(screen.getByTestId('housead-empty_state_promo')).toBeInTheDocument();
  });

  test('empty list returns null when hideEmpty=true', async () => {
    resolveRooms({ rooms: [] });
    const { container } = render(<ChatroomsSidebar hideEmpty />);
    // Wait until data resolves
    await waitFor(() => expect(axiosGet).toHaveBeenCalled());
    // Should render nothing
    expect(container).toBeEmptyDOMElement();
  });

  test('populated list: renders titles, unread badges, last message, selection, and secondary ad after 3rd item (free)', async () => {
    isPremiumValue = false;
    const rooms = [
      { id: 1, title: 'Alpha', unreadCount: 2, lastMessage: { content: 'Hello' } },
      { id: 2, name: 'Bravo', _count: { unread: 0 }, lastMessage: { content: 'Yo' } },
      { id: 3, displayName: 'Charlie' },
      { id: 4 }, // will become "Room #4"
    ];
    resolveRooms({ rooms });

    const onSelect = jest.fn();
    render(<ChatroomsSidebar onSelect={onSelect} activeRoomId={2} />);

    // Wait for list
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Room #4')).toBeInTheDocument();

    // Unread badge only for non-zero
    expect(screen.getAllByTestId('badge').map((b) => b.textContent)).toContain('2');

    // Last message snippets
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Yo')).toBeInTheDocument();

    // activeRoomId=2 should apply background style on that button
    const buttons = screen.getAllByRole('button');
    const activeBtn = buttons.find((btn) => btn.textContent.includes('Bravo'));
    expect(activeBtn).toHaveStyle({ background: 'var(--mantine-color-gray-1)' });

    // click selection
    fireEvent.click(screen.getByText('Charlie'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));

    // Primary ad shown at top (free)
    expect(screen.getByTestId('adslot-SIDEBAR_PRIMARY')).toBeInTheDocument();

    // Secondary ad occurs after idx === 2 (i.e., after "Charlie")
    expect(screen.getByTestId('adslot-SIDEBAR_SECONDARY')).toBeInTheDocument();
  });

  test('premium user with populated list: no ads at all', async () => {
    isPremiumValue = true;
    resolveRooms([{ id: 1, title: 'OnlyRoom' }]);

    render(<ChatroomsSidebar />);

    expect(await screen.findByText('OnlyRoom')).toBeInTheDocument();
    expect(screen.queryByTestId('adslot-SIDEBAR_PRIMARY')).not.toBeInTheDocument();
    expect(screen.queryByTestId('adslot-SIDEBAR_SECONDARY')).not.toBeInTheDocument();
    expect(screen.queryByTestId('housead-empty_state_promo')).not.toBeInTheDocument();
  });

  test('error state shows alert and Retry reloads the page', async () => {
    rejectRooms({
      response: { data: { message: 'Could not load' } },
    });

    render(<ChatroomsSidebar />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(reloadSpy).toHaveBeenCalled();
  });

  test('handles non-array data shape by reading data.rooms', async () => {
    resolveRooms({ rooms: [{ id: 'x', title: 'ViaRoomsProp' }] });
    render(<ChatroomsSidebar />);
    expect(await screen.findByText('ViaRoomsProp')).toBeInTheDocument();
  });
});
