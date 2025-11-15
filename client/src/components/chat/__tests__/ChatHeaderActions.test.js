// client/src/components/chat/__tests__/ChatHeaderActions.test.js
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatHeaderActions from '../ChatHeaderActions.jsx';

// Mock react-router navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock CallContext hook
const mockStartCall = vi.fn();
vi.mock('@/context/CallContext', () => ({
  useCall: () => ({
    startCall: mockStartCall,
    active: null,
    incoming: null,
  }),
}));

function renderUI(ui) {
  // Wrap in a minimal provider-free render since we mocked navigate/useCall
  return render(ui);
}

describe('ChatHeaderActions', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockStartCall.mockReset();
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
    expect(mockStartCall).toHaveBeenCalledWith({ calleeId: 42, mode: 'AUDIO' });

    await user.click(videoBtn);
    expect(mockStartCall).toHaveBeenCalledWith({ calleeId: 42, mode: 'VIDEO' });
  });

  test('disables buttons when a call is active or incoming (pending state)', async () => {
    // Re-mock useCall to simulate active call
    vi.doMock('@/context/CallContext', () => ({
      useCall: () => ({
        startCall: mockStartCall,
        active: { callId: 'abc' },
        incoming: null,
      }),
    }));
    const { default: ChatHeaderActionsHot } = await vi.importActual('../ChatHeaderActions.jsx');

    renderUI(<ChatHeaderActionsHot peerUser={{ id: 7 }} />);
    const audioBtn = screen.queryByRole('button', { name: /start audio call/i });
    const videoBtn = screen.queryByRole('button', { name: /start video call/i });
    // For 1:1, both exist but are disabled
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

    // In group mode there is no audio button (always 1:1 only)
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
