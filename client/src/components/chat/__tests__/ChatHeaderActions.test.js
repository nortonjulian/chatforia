import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatHeaderActions from '../ChatHeaderActions.jsx';

/* ---------------- Mocks ---------------- */

// react-router: mock useNavigate but keep real everything else
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// CallContext: central mutable state object we can tweak in tests
const mockCallState = {
  startCall: jest.fn(),
  active: null,
  incoming: null,
};

jest.mock('@/context/CallContext', () => ({
  __esModule: true,
  useCall: () => mockCallState,
}));

/* ---------------- Helpers ---------------- */

function renderUI(ui) {
  return render(ui);
}

/* ---------------- Tests ---------------- */

describe('ChatHeaderActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallState.startCall.mockReset();
    mockCallState.active = null;
    mockCallState.incoming = null;
    mockNavigate.mockReset();
  });

  test('returns null when peerUser is missing or has no id', () => {
    const { container: c1 } = renderUI(<ChatHeaderActions peerUser={null} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = renderUI(<ChatHeaderActions peerUser={{}} />);
    expect(c2.firstChild).toBeNull();
  });

  test('renders audio and video buttons for direct (1:1) and triggers startCall with correct modes', async () => {
    const user = userEvent.setup();
    renderUI(<ChatHeaderActions peerUser={{ id: 42, name: 'Zed' }} />);

    const audioBtn = screen.getByRole('button', { name: /start audio call/i });
    const videoBtn = screen.getByRole('button', { name: /start video call/i });

    expect(audioBtn).toBeEnabled();
    expect(videoBtn).toBeEnabled();

    await user.click(audioBtn);
    expect(mockCallState.startCall).toHaveBeenCalledWith({ calleeId: 42, mode: 'AUDIO' });

    await user.click(videoBtn);
    expect(mockCallState.startCall).toHaveBeenCalledWith({ calleeId: 42, mode: 'VIDEO' });
  });

  test('disables buttons when a call is active', () => {
    mockCallState.active = { callId: 'abc' };

    renderUI(<ChatHeaderActions peerUser={{ id: 7 }} />);

    const audioBtn = screen.getByRole('button', { name: /start audio call/i });
    const videoBtn = screen.getByRole('button', { name: /start video call/i });

    expect(audioBtn).toBeDisabled();
    expect(videoBtn).toBeDisabled();
  });

  test('hides direct video button when enableDirectVideo=false', () => {
    renderUI(
      <ChatHeaderActions
        peerUser={{ id: 99 }}
        enableDirectVideo={false}
      />
    );

    // Audio still there
    expect(screen.getByRole('button', { name: /start audio call/i })).toBeInTheDocument();
    // Video (direct) hidden
    expect(screen.queryByRole('button', { name: /start video call/i })).not.toBeInTheDocument();
  });

  test('group mode: shows group video button and navigates to /video', async () => {
    const user = userEvent.setup();
    renderUI(
      <ChatHeaderActions
        peerUser={{ id: 1 }}
        isGroup
      />
    );

    // In group mode there is no audio button (audio is 1:1 only)
    expect(screen.queryByRole('button', { name: /start audio call/i })).not.toBeInTheDocument();

    const groupVideoBtn = screen.getByRole('button', { name: /start group video/i });
    await user.click(groupVideoBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/video');
  });

  test('group mode: navigates to specific room when groupRoomSlug provided', async () => {
    const user = userEvent.setup();
    renderUI(
      <ChatHeaderActions
        peerUser={{ id: 2 }}
        isGroup
        groupRoomSlug="eng-standup"
      />
    );

    const groupVideoBtn = screen.getByRole('button', { name: /start group video/i });
    await user.click(groupVideoBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/video?room=eng-standup');
  });
});
