import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import CallShell from '../call/CallShell.jsx';

describe('CallShell', () => {
  test('renders structure, videos, refs, and slots', () => {
    const remoteVideoRef = createRef();
    const localVideoRef = createRef();

    const { container } = render(
      <CallShell
        callId="call-xyz"
        remoteVideoRef={remoteVideoRef}
        localVideoRef={localVideoRef}
        topRight={<button data-testid="top-right">TopRight</button>}
        bottomBar={<div data-testid="bottom-bar">Controls</div>}
      >
        <div data-testid="overlay-child">Overlay Content</div>
      </CallShell>
    );

    // Slots/labels
    expect(screen.getByText(/Call ID:\s*call-xyz/i)).toBeInTheDocument();
    expect(screen.getByTestId('overlay-child')).toBeInTheDocument();
    expect(screen.getByTestId('top-right')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-bar')).toBeInTheDocument();

    // Videos
    const videos = container.querySelectorAll('video');
    expect(videos).toHaveLength(2);
    const [remoteVid, localVid] = videos;

    // Prefer DOM properties; fall back to attributes when properties aren't modeled by JSDOM
    expect(remoteVid.autoplay || remoteVid.hasAttribute('autoplay')).toBe(true);
    expect(remoteVid.playsInline || remoteVid.hasAttribute('playsinline')).toBe(true);
    expect(remoteVid.muted).toBe(false);

    expect(localVid.autoplay || localVid.hasAttribute('autoplay')).toBe(true);
    expect(localVid.playsInline || localVid.hasAttribute('playsinline')).toBe(true);
    expect(localVid.muted).toBe(true); // <-- property check fixes your failure

    // Refs attached
    expect(remoteVideoRef.current).toBe(remoteVid);
    expect(localVideoRef.current).toBe(localVid);

    // "You" badge
    expect(screen.getByText(/^You$/)).toBeInTheDocument();
  });
});
