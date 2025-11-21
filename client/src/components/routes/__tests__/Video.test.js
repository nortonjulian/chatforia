import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock heavyweight children so we can assert render + props
jest.mock('@/video/DirectVideo.jsx', () => (props) => (
  <div data-testid="direct-video">
    DirectVideo initialPeerId={String(props.initialPeerId || '')}
  </div>
));
jest.mock('@/video/VideoCall.jsx', () => (props) => (
  <div data-testid="video-call">
    VideoCall identity={String(props.identity)} room={String(props.room)}
  </div>
));

import VideoHub from '../Video.jsx';

function renderWithRouter(initialEntry = '/video', currentUser = { id: 42 }) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/video" element={<VideoHub currentUser={currentUser} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('VideoHub', () => {
  it('shows the chooser screen by default (no params)', () => {
    renderWithRouter('/video');
    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByText('Choose a video type.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Join / Create' })
    ).toBeInTheDocument();
  });

  it('navigates to Direct Video flow when Start is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter('/video');

    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText('Direct Video')).toBeInTheDocument();
    expect(screen.getByTestId('direct-video')).toBeInTheDocument();
  });

  it('navigates to Rooms flow when Join / Create is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter('/video');

    await user.click(
      screen.getByRole('button', { name: 'Join / Create' })
    );
    expect(screen.getByText('Rooms')).toBeInTheDocument();
    expect(screen.getByLabelText('Room name')).toBeInTheDocument();

    const joinBtn = screen.getByRole('button', { name: 'Join / Create' });
    expect(joinBtn).toBeDisabled();
  });

  it('Rooms: enables Join button when room is entered and shows VideoCall after join', async () => {
    const user = userEvent.setup();
    renderWithRouter('/video');

    // Go to Rooms tab
    await user.click(
      screen.getByRole('button', { name: 'Join / Create' })
    );

    const roomInput = screen.getByLabelText('Room name');
    await user.type(roomInput, 'team-standup');

    // 🔧 Match the actual label text: "Join / Create"
    const joinBtn = screen.getByRole('button', { name: 'Join / Create' });
    expect(joinBtn).toBeEnabled();

    await user.click(joinBtn);
    const vc = screen.getByTestId('video-call');
    expect(vc).toBeInTheDocument();
    expect(vc.textContent).toMatch(/room=team-standup/);
    expect(vc.textContent).toMatch(/identity=42/);
  });

  it('deep-link: /video?room=standup opens VideoCall immediately (Rooms flow)', () => {
    renderWithRouter('/video?room=standup');

    // Should bypass chooser and render Rooms with VideoCall
    const vc = screen.getByTestId('video-call');
    expect(vc).toBeInTheDocument();
    expect(vc.textContent).toMatch(/room=standup/);
  });

  it('deep-link: /video?peerId=123 opens DirectVideo flow', () => {
    renderWithRouter('/video?peerId=123');

    expect(screen.getByText('Direct Video')).toBeInTheDocument();
    const dv = screen.getByTestId('direct-video');
    expect(dv).toBeInTheDocument();
    expect(dv.textContent).toMatch(/initialPeerId=123/);
  });
});
