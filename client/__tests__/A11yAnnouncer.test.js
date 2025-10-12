import { render, screen } from '@testing-library/react';
import A11yAnnouncer from '@/components/A11yAnnouncer'; // adjust path if needed
import { act } from 'react-dom/test-utils';

describe('A11yAnnouncer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Ensure no leftover announcer from previous tests
    delete window.__announce;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('registers and unregisters window.__announce', () => {
    const { unmount } = render(<A11yAnnouncer />);
    expect(typeof window.__announce).toBe('function');

    unmount();
    expect(window.__announce).toBeUndefined();
  });

  test('announces politely (aria-live="polite") after 10ms', () => {
    render(<A11yAnnouncer />);

    // Initially empty
    const politeRegion = document.getElementById('a11y-announcer-polite');
    const assertiveRegion = document.getElementById('a11y-announcer-assertive');
    expect(politeRegion).toBeInTheDocument();
    expect(assertiveRegion).toBeInTheDocument();
    expect(politeRegion.textContent).toBe('');
    expect(assertiveRegion.textContent).toBe('');

    // Call the global announcer (default is polite)
    window.__announce('Hello politely');

    // Immediately after call, it should be cleared to '' and set later
    expect(politeRegion.textContent).toBe('');

    // Advance timers to trigger the setTimeout(…, 10)
    act(() => {
      jest.advanceTimersByTime(11);
    });

    expect(politeRegion.textContent).toBe('Hello politely');
    expect(assertiveRegion.textContent).toBe('');
  });

  test('announces assertively (aria-live="assertive") after 10ms and does not affect polite region', () => {
    render(<A11yAnnouncer />);

    // Pre-fill polite region to ensure assertive updates don't touch it
    window.__announce('A polite baseline');
    act(() => {
      jest.advanceTimersByTime(11);
    });
    const politeRegion = document.getElementById('a11y-announcer-polite');
    const assertiveRegion = document.getElementById('a11y-announcer-assertive');
    expect(politeRegion.textContent).toBe('A polite baseline');
    expect(assertiveRegion.textContent).toBe('');

    // Now assertive
    window.__announce('Urgent message', { assertive: true });

    // Immediately after call it should be cleared
    expect(assertiveRegion.textContent).toBe('');

    act(() => {
      jest.advanceTimersByTime(10);
    });

    expect(assertiveRegion.textContent).toBe('Urgent message');
    // Polite remains unchanged
    expect(politeRegion.textContent).toBe('A polite baseline');
  });
});
