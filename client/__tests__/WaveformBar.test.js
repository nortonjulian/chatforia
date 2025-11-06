/**
 * @file client/__tests__/WaveformBar.test.js
 */

import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WaveformBar from '@/components/WaveformBar';

// ---- Global mocks ----

// Mock canvas 2D context
const mockClearRect = jest.fn();
const mockFillRect = jest.fn();
beforeAll(() => {
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });

  // jsdom doesn't implement <canvas>.getContext; provide a stub
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({
      clearRect: mockClearRect,
      fillRect: mockFillRect,
    }),
  });

  // Ensure canvas has a measurable clientWidth
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    get() {
      // parent wrapper is 260px wide in component
      return 260;
    },
  });
});

// Reset drawing calls between tests
beforeEach(() => {
  mockClearRect.mockClear();
  mockFillRect.mockClear();
  jest.clearAllMocks();
});

// Stub fetch
const mockFetch = (arrayBufferPromise) => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      arrayBuffer: () => arrayBufferPromise,
    })
  );
};

// Stub AudioContext with controllable decodeAudioData
class MockAudioContext {
  constructor() {
    this.closed = false;
  }
  async decodeAudioData(buf) {
    // Create a predictable mono channel
    const length = 36000; // arbitrary, larger than buckets
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      // simple waveform-ish pattern
      data[i] = Math.sin(i / 10) * 0.5;
    }
    return {
      getChannelData: (idx) => {
        if (idx !== 0) throw new Error('Only mono supported in mock');
        return data;
      },
    };
  }
  close() {
    this.closed = true;
  }
}
beforeEach(() => {
  window.AudioContext = MockAudioContext;
  // some browsers use webkit prefix in code path; mirror it
  window.webkitAudioContext = MockAudioContext;
});

describe('<WaveformBar />', () => {
  test('fetches audio, decodes, and draws 180 bars', async () => {
    // Arrange
    mockFetch(Promise.resolve(new ArrayBuffer(8)));

    render(<WaveformBar src="https://example.com/audio.wav" />);

    // Assert: wait until drawing happens
    await waitFor(() => {
      // 180 buckets => 180 fillRect calls
      expect(mockFillRect).toHaveBeenCalled();
      expect(mockFillRect.mock.calls.length).toBe(180);
      expect(mockClearRect).toHaveBeenCalled(); // canvas cleared first
    });

    // Also ensure fetch called with CORS
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/audio.wav', { mode: 'cors' });
  });

  test('sets canvas size based on DPR and height prop', async () => {
    mockFetch(Promise.resolve(new ArrayBuffer(8)));

    const { container } = render(<WaveformBar src="/file" height={28} />);
    const canvas = container.querySelector('canvas');

    // Size is set in effect after peaks computed; wait until a draw occurs
    await waitFor(() => {
      expect(mockFillRect).toHaveBeenCalled();
    });

    // width = clientWidth * DPR = 260 * 2, height = height * DPR = 28 * 2
    expect(canvas.width).toBe(260 * 2);
    expect(canvas.height).toBe(28 * 2);
  });

  test('handles fetch failure gracefully (no crash, no draw)', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network fail')));

    render(<WaveformBar src="/bad" />);

    // Give the effect a tick to run and fail; there should be no drawing
    await waitFor(
      () => {
        expect(mockFillRect).not.toHaveBeenCalled();
      },
      { timeout: 100 }
    );
  });

  test('does not draw if unmounted before decode completes (cleanup alive=false)', async () => {
    // Make decodeAudioData resolve after a small delay to simulate slow decode
    const slowBuffer = Promise.resolve(new ArrayBuffer(8));
    mockFetch(slowBuffer);

    const decodeSpy = jest
      .spyOn(MockAudioContext.prototype, 'decodeAudioData')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(async () => {
              // Return a minimal audio buffer-like object
              const length = 1800;
              const data = new Float32Array(length);
              for (let i = 0; i < length; i++) data[i] = (i % 10) / 10;
              resolve({
                getChannelData: () => data,
              });
            }, 30);
          })
      );

    const { unmount } = render(<WaveformBar src="/slow" />);
    // Unmount before decode resolves
    unmount();

    // Wait longer than the decode delay and confirm no drawings happened
    await new Promise((r) => setTimeout(r, 60));
    expect(mockFillRect).not.toHaveBeenCalled();
    expect(decodeSpy).toHaveBeenCalled();
  });

  test('re-renders when src changes (fetch called again)', async () => {
    mockFetch(Promise.resolve(new ArrayBuffer(8)));
    const { rerender } = render(<WaveformBar src="/a.wav" />);

    await waitFor(() => {
      expect(mockFillRect).toHaveBeenCalled();
    });

    mockFillRect.mockClear();
    mockFetch(Promise.resolve(new ArrayBuffer(8)));

    rerender(<WaveformBar src="/b.wav" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith('/b.wav', { mode: 'cors' });
      expect(mockFillRect).toHaveBeenCalled(); // drew again for new peaks
    });
  });
});
