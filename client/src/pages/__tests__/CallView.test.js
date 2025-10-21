import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ---- Router mocks ----
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useParams: () => ({ callId: 'abc123' }),
  useNavigate: () => mockNavigate,
}));

// ---- Hook & component mocks ----
const mockUseLiveCaptions = jest.fn(() => ({ segments: [{ text: 'hello' }] }));
jest.mock('@/hooks/useLiveCaptions', () => ({
  __esModule: true,
  useLiveCaptions: (args) => mockUseLiveCaptions(args),
}));

// CallShell renders slots so we can interact with topRight/bottomBar/children easily
jest.mock('@/features/call/CallShell', () => ({
  __esModule: true,
  default: ({ callId, topRight, bottomBar, children }) => (
    <div data-testid="callshell" data-callid={callId}>
      <div data-testid="slot-topRight">{topRight}</div>
      <div data-testid="slot-children">{children}</div>
      <div data-testid="slot-bottomBar">{bottomBar}</div>
    </div>
  ),
}));

// CallControls exposes buttons to trigger onEnd and onToggleCaptions
jest.mock('@/features/call/components/CallControls', () => ({
  __esModule: true,
  default: ({ onEnd, onToggleCaptions, currentUser }) => (
    <div data-testid="callcontrols" data-cc={String(!!currentUser?.a11yLiveCaptions)}>
      <button data-testid="btn-end" onClick={onEnd}>END</button>
      <button data-testid="btn-cc-on" onClick={() => onToggleCaptions?.(true)}>CC ON</button>
      <button data-testid="btn-cc-off" onClick={() => onToggleCaptions?.(false)}>CC OFF</button>
    </div>
  ),
}));

jest.mock('@/features/call/components/RttSidebar', () => ({
  __esModule: true,
  default: ({ callId }) => <div data-testid="rtt" data-callid={callId} />,
}));

jest.mock('@/components/CaptionOverlay', () => ({
  __esModule: true,
  default: ({ segments, font, bg }) => (
    <div data-testid="captions" data-font={font} data-bg={bg}>
      {Array.isArray(segments) ? segments.length : 0}
    </div>
  ),
}));

// ---- SUT ----
import CallView from '../CallView';

describe('CallView', () => {
  let originalFetch;
  let originalMedia;

  beforeAll(() => {
    originalFetch = global.fetch;
    originalMedia = navigator.mediaDevices;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    Object.defineProperty(navigator, 'mediaDevices', { value: originalMedia, configurable: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock /me and /users/me/a11y
    global.fetch = jest.fn(async (url) => {
      if (url === '/me') {
        return {
          ok: true,
          json: async () => ({
            user: { id: 1, a11yLiveCaptions: true, a11yCaptionFont: 'lg', a11yCaptionBg: 'dark' },
          }),
        };
      }
      if (url === '/users/me/a11y') {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    // Mock getUserMedia with stoppable tracks
    const stopFn = jest.fn();
    const stream = { getTracks: () => [{ stop: stopFn }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue(stream),
        __streamStop: stopFn, // expose for assertions
      },
    });
  });

  test('loads user and renders call shell with callId; captions enabled by user; useLiveCaptions args correct', async () => {
    render(<CallView />);

    // Initial loading state
    expect(screen.getByText(/Loading…/i)).toBeInTheDocument();

    // Wait for user to load and UI to render
    await waitFor(() => expect(screen.getByTestId('callshell')).toBeInTheDocument());
    expect(screen.getByTestId('callshell')).toHaveAttribute('data-callid', 'abc123');

    // getUserMedia called for local preview
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });

    // Captions visible because user.a11yLiveCaptions = true
    expect(screen.getByTestId('captions')).toBeInTheDocument();
    expect(screen.getByTestId('captions')).toHaveAttribute('data-font', 'lg');
    expect(screen.getByTestId('captions')).toHaveAttribute('data-bg', 'dark');

    // Hook called with expected params
    expect(mockUseLiveCaptions).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'abc123', enabled: true, language: 'en-US' })
    );
  });

  test('RTT toggle button shows and hides the sidebar', async () => {
    render(<CallView />);

    await waitFor(() => screen.getByTestId('slot-topRight'));

    // Initially hidden
    expect(screen.queryByTestId('rtt')).toBeNull();

    // Click "Show Live Chat (RTT)"
    fireEvent.click(screen.getByText(/Show Live Chat \(RTT\)/i));
    expect(screen.getByTestId('rtt')).toBeInTheDocument();
    expect(screen.getByTestId('rtt')).toHaveAttribute('data-callid', 'abc123');

    // Click "Hide Live Chat (RTT)"
    fireEvent.click(screen.getByText(/Hide Live Chat \(RTT\)/i));
    expect(screen.queryByTestId('rtt')).toBeNull();
  });

  test('End button navigates back', async () => {
    render(<CallView />);
    await waitFor(() => screen.getByTestId('callcontrols'));

    fireEvent.click(screen.getByTestId('btn-end'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  test('caption toggle PATCHes and shows/hides CaptionOverlay accordingly', async () => {
    const fetchSpy = global.fetch;

    render(<CallView />);
    await waitFor(() => screen.getByTestId('callcontrols'));

    // Initially captions on
    expect(screen.getByTestId('captions')).toBeInTheDocument();
    expect(mockUseLiveCaptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true })
    );

    // Turn captions off via CallControls mock
    fireEvent.click(screen.getByTestId('btn-cc-off'));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/users/me/a11y',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ a11yLiveCaptions: false }),
        })
      )
    );

    // Overlay removed and hook called with enabled=false on next render
    await waitFor(() => expect(screen.queryByTestId('captions')).toBeNull());
    expect(mockUseLiveCaptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );

    // Turn captions on again
    fireEvent.click(screen.getByTestId('btn-cc-on'));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/users/me/a11y',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ a11yLiveCaptions: true }),
        })
      )
    );
    await waitFor(() => expect(screen.getByTestId('captions')).toBeInTheDocument());
  });

  test('stops media tracks on unmount (cleanup)', async () => {
    const { unmount } = render(<CallView />);
    await waitFor(() => screen.getByTestId('callshell'));

    // Unmount and ensure track.stop() called
    unmount();
    expect(navigator.mediaDevices.__streamStop).toHaveBeenCalled();
  });
});
