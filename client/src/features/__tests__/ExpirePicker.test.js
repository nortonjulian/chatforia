import { render, screen, fireEvent } from '@testing-library/react';

// ---- Mocks ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Select = ({ label, data, value, onChange, withinPortal, allowDeselect }) => (
    <div
      data-testid="select"
      data-label={label}
      data-value={String(value)}
      data-withinportal={String(!!withinPortal)}
      data-allowdeselect={String(!!allowDeselect)}
    >
      {/* Render options as buttons so we can simulate selection */}
      {Array.isArray(data) &&
        data.map((o) => (
          <button
            key={o.value}
            data-testid="opt"
            data-value={o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
    </div>
  );
  return { __esModule: true, Select };
});

// Entitlements hook
const useEntitlementsMock = jest.fn();
jest.mock('@/hooks/useEntitlements', () => ({
  __esModule: true,
  default: () => useEntitlementsMock(),
}));

// SUT
import ExpirePicker from './ExpirePicker';

describe('ExpirePicker', () => {
  beforeEach(() => {
    useEntitlementsMock.mockReset();
  });

  test('builds options with maxDays = 1 (hours + 1 day)', () => {
    useEntitlementsMock.mockReturnValue({ entitlements: { expireMaxDays: 1 } });

    render(<ExpirePicker value={0} onChange={jest.fn()} />);

    const select = screen.getByTestId('select');
    expect(select).toHaveAttribute('data-label', 'Disappearing messages');
    expect(select).toHaveAttribute('data-value', '0');
    expect(select).toHaveAttribute('data-withinportal', 'true');
    expect(select).toHaveAttribute('data-allowdeselect', 'false');

    // Should have 4 hour-based + 1 day = 5 options
    const opts = screen.getAllByTestId('opt');
    expect(opts).toHaveLength(5);
    // Spot-check labels present
    expect(opts.map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['Off', '1 hour', '6 hours', '12 hours', '1 day'])
    );
    // No multi-day labels beyond 1
    expect(opts.map((o) => o.textContent).join(' ')).not.toMatch(/\b3 days\b/);
  });

  test('builds options with maxDays = 30 (includes 1,3,7,14,30 days)', () => {
    useEntitlementsMock.mockReturnValue({ entitlements: { expireMaxDays: 30 } });
    render(<ExpirePicker value={0} onChange={jest.fn()} />);

    const labels = screen.getAllByTestId('opt').map((o) => o.textContent);
    // 4 hour options + 5 day options = 9 total
    expect(labels).toHaveLength(9);
    expect(labels).toEqual(
      expect.arrayContaining(['1 day', '3 days', '7 days', '14 days', '30 days'])
    );
  });

  test('respects custom label and converts onChange value to Number', () => {
    useEntitlementsMock.mockReturnValue({ entitlements: { expireMaxDays: 7 } });
    const onChange = jest.fn();

    render(<ExpirePicker label="Expire after" value={null} onChange={onChange} />);

    const select = screen.getByTestId('select');
    // null/undefined value → defaults to '0'
    expect(select).toHaveAttribute('data-value', '0');
    expect(select).toHaveAttribute('data-label', 'Expire after');

    // Click the "6 hours" option (21600 seconds)
    const sixHours = screen.getAllByTestId('opt').find((o) => o.textContent === '6 hours');
    fireEvent.click(sixHours);

    expect(onChange).toHaveBeenCalledWith(6 * 60 * 60); // Number, not string
    expect(typeof onChange.mock.calls[0][0]).toBe('number');
  });
});
