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
// We’ll vary `mockUnseenValue` per test, and spy on `mockReset`
let mockUnseenValue = 0;
const mockReset = jest.fn();

jest.mock('@/stores/statusNotifStore', () => {
  const useStatusNotifStore = (selector) =>
    selector({ unseen: mockUnseenValue, reset: mockReset });
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
  mockUnseenValue = 0;
});

describe('StatusBadge', () => {
  test('renders the button without an indicator when unseen = 0', () => {
    mockUnseenValue = 0;
    renderSut();

    // Button is present
    const btn = screen.getByRole('button', { name: /open status feed/i });
    expect(btn).toBeInTheDocument();

    // No numeric indicator shown
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  test('shows indicator with count when unseen > 0', () => {
    mockUnseenValue = 3;
    renderSut();

    // Button is present
    expect(
      screen.getByRole('button', { name: /open status feed/i })
    ).toBeInTheDocument();

    // Indicator label is rendered as text
    const indicatorWrapper = screen.getByLabelText(/3 new/i);
    expect(indicatorWrapper).toBeInTheDocument();
    expect(indicatorWrapper).toHaveAttribute('label', '3');
  });

  test('clicking the button resets and navigates to /status', () => {
    mockUnseenValue = 5;
    renderSut();

    const btn = screen.getByRole('button', { name: /open status feed/i });
    fireEvent.click(btn);

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/status');
  });
});
