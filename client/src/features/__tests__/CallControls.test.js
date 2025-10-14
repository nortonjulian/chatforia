import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CallControls from '../call/components/CallControls';

describe('CallControls', () => {
  test('renders with initial states and labels', () => {
    render(
      <CallControls
        callId="c1"
        currentUser={{ a11yLiveCaptions: true }}
        onEnd={jest.fn()}
        onToggleCaptions={jest.fn()}
      />
    );

    // Camera initially on
    expect(screen.getByTitle(/camera on/i)).toBeInTheDocument();
    expect(screen.getByText('📷')).toBeInTheDocument();

    // Mic initially on
    expect(screen.getByTitle(/mic on/i)).toBeInTheDocument();
    expect(screen.getByText('🎙️')).toBeInTheDocument();

    // Captions reflect currentUser.a11yLiveCaptions
    expect(screen.getByTitle(/captions on/i)).toBeInTheDocument();
    expect(screen.getByText('CC')).toBeInTheDocument();
  });

  test('toggles camera button (icon and title)', () => {
    render(<CallControls currentUser={{}} onEnd={jest.fn()} />);
    const camBtn = screen.getByTitle(/camera on/i);
    // toggle off
    fireEvent.click(camBtn);
    expect(screen.getByTitle(/camera off/i)).toBeInTheDocument();
    expect(screen.getByText('🚫📷')).toBeInTheDocument();
    // toggle on again
    fireEvent.click(screen.getByTitle(/camera off/i));
    expect(screen.getByTitle(/camera on/i)).toBeInTheDocument();
    expect(screen.getByText('📷')).toBeInTheDocument();
  });

  test('toggles mic button (icon and title)', () => {
    render(<CallControls currentUser={{}} onEnd={jest.fn()} />);
    const micBtn = screen.getByTitle(/mic on/i);
    fireEvent.click(micBtn);
    expect(screen.getByTitle(/mic muted/i)).toBeInTheDocument();
    expect(screen.getByText('🔇')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/mic muted/i));
    expect(screen.getByTitle(/mic on/i)).toBeInTheDocument();
    expect(screen.getByText('🎙️')).toBeInTheDocument();
  });

  test('toggles captions and calls onToggleCaptions with next value', async () => {
    const onToggleCaptions = jest.fn().mockResolvedValue(undefined);
    // Start with captions off via currentUser.a11yLiveCaptions = false
    render(<CallControls currentUser={{ a11yLiveCaptions: false }} onToggleCaptions={onToggleCaptions} onEnd={jest.fn()} />);

    // Initially off → button title says "Captions off"
    const ccBtnOff = screen.getByTitle(/captions off/i);
    // "inactive" class applied via opacity-70
    expect(ccBtnOff.className).toMatch(/opacity-70/);

    // Toggle to on
    fireEvent.click(ccBtnOff);
    await waitFor(() => expect(onToggleCaptions).toHaveBeenCalledWith(true));
    // Now title should be "Captions on"
    expect(screen.getByTitle(/captions on/i)).toBeInTheDocument();
    // active state should not include opacity-70
    expect(screen.getByTitle(/captions on/i).className).not.toMatch(/opacity-70/);

    // Toggle back to off
    fireEvent.click(screen.getByTitle(/captions on/i));
    await waitFor(() => expect(onToggleCaptions).toHaveBeenCalledWith(false));
    expect(screen.getByTitle(/captions off/i)).toBeInTheDocument();
  });

  test('End button calls onEnd', () => {
    const onEnd = jest.fn();
    render(<CallControls currentUser={{}} onEnd={onEnd} />);
    fireEvent.click(screen.getByText(/^End$/));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
