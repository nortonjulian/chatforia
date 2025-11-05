/**
 * @file StatusBadge.test.js
 * Tests for client/src/components/StatusBadge.jsx
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

// ---- mock navigate ----
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const real = jest.requireActual('react-router-dom');
  return {
    ...real,
    useNavigate: () => mockNavigate,
  };
});

// ---- mock store ----
// We’ll vary `unseenValue` per test, and spy on `resetMock`
let unseenValue = 0;
const resetMock = jest.fn();

jest.mock('@/stores/statusNotifStore', () => {
  const useStatusNotifStore = (selector) =>
    selector({ unseen: unseenValue, reset: resetMock });
  return { __esModule: true, useStatusNotifStore };
});

// ---- SUT after mocks ----
import StatusBadge from '@/components/StatusBadge.jsx';

// ---- render helper ----
function renderSut() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <StatusBadge />
      </MemoryRouter>
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  unseenValue = 0;
});

describe('StatusBadge', () => {
  test('renders the button without an indicator when unseen = 0', () => {
    unseenValue = 0;
    renderSut();

    // Button is present
    const btn = screen.getByRole('button', { name: /open status feed/i });
    expect(btn).toBeInTheDocument();

    // No numeric indicator shown
    // (Indicator renders its label text; with 0 unseen there should be no "0" badge)
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  test('shows indicator with count when unseen > 0', () => {
    unseenValue = 3;
    renderSut();

    // Button is present
    expect(
      screen.getByRole('button', { name: /open status feed/i })
    ).toBeInTheDocument();

    // Indicator label is rendered as text
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('clicking the button resets and navigates to /status', () => {
    unseenValue = 5;
    renderSut();

    const btn = screen.getByRole('button', { name: /open status feed/i });
    fireEvent.click(btn);

    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/status');
  });
});
