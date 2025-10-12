import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import CallShell from './CallShell';

describe('CallShell', () => {
  test('renders structure, videos, refs, and slots', () => {
    const remoteVideoRef = createRef();
    const localVideoRef = createRef();

    render(
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

    // Call ID text
    expect(screen.getByText(/Call ID:\s*call-xyz/i)).toBeInTheDocument();

    // Overlay/children slot
    expect(screen.getByTestId('overlay-child')).toBeInTheDocument();

    // Top-right slot
    expect(screen.getByTestId('top-right')).toBeInTheDocument();

    // Bottom bar slot
    expect(screen.getByTestId('bottom-bar')).toBeInTheDocument();

    // Videos
    const videos = screen.getAllByRole('video');
    expect(videos).toHaveLength(2);

    const [remoteVid, localVid] = videos;

    // Remote video: autoplay + playsInline, not muted
    expect(remoteVid).toHaveAttribute('autoplay');
    expect(remoteVid).toHaveAttribute('playsinline');
    expect(remoteVid).not.toHaveAttribute('muted');

    // Local video: autoplay + playsInline + muted
    expect(localVid).toHaveAttribute('autoplay');
    expect(localVid).toHaveAttribute('playsinline');
    expect(localVid).toHaveAttribute('muted');

    // Refs are attached to the right elements
    expect(remoteVideoRef.current).toBe(remoteVid);
    expect(localVideoRef.current).toBe(localVid);

    // "You" badge on local video container
    expect(screen.getByText(/^You$/)).toBeInTheDocument();
  });
});
