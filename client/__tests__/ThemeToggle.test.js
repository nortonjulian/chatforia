import { render, screen, fireEvent } from '@testing-library/react';
import ThemeToggle from '@/components/ThemeToggle';

// ---- Mocks ----

// Mantine primitives
jest.mock('@mantine/core', () => {
  const React = require('react');
  const ActionIcon = ({ children, onClick, 'aria-label': ariaLabel, ...p }) => (
    <button type="button" aria-label={ariaLabel} onClick={onClick} {...p}>
      {children}
    </button>
  );
  const Tooltip = ({ label, children }) => (
    <div>
      <span data-testid="tooltip-label">{label}</span>
      {children}
    </div>
  );
  return { ActionIcon, Tooltip };
});

// Icons
jest.mock('lucide-react', () => ({
  Sun: (props) => <span data-testid="icon-sun" {...props} />,
  Moon: (props) => <span data-testid="icon-moon" {...props} />,
}));

// themeManager functions (names must start with "mock" to be referenced in jest.mock factory)
const mockGetTheme = jest.fn();
const mockSetTheme = jest.fn();
const mockIsDarkTheme = jest.fn();

jest.mock('@/utils/themeManager', () => ({
  __esModule: true,
  getTheme: (...args) => mockGetTheme(...args),
  setTheme: (...args) => mockSetTheme(...args),
  isDarkTheme: (...args) => mockIsDarkTheme(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ThemeToggle', () => {
  test('dark-like theme: shows Sun icon, tooltip says switch to Dawn, aria-pressed=true; click sets theme to dawn', () => {
    mockGetTheme.mockReturnValue('midnight');
    mockIsDarkTheme.mockReturnValue(true);

    render(<ThemeToggle />);

    // Tooltip label
    expect(screen.getByTestId('tooltip-label')).toHaveTextContent('Switch to Dawn mode');

    // Icon for dark-like is Sun (since clicking would go to Dawn)
    expect(screen.getByTestId('icon-sun')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-moon')).not.toBeInTheDocument();

    const btn = screen.getByRole('switch', { name: /toggle theme/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(btn);

    // onToggle not provided -> setTheme called with dawn
    expect(mockSetTheme).toHaveBeenCalledWith('dawn');
  });

  test('light theme: shows Moon icon, tooltip says switch to Midnight, aria-pressed=false; click sets theme to midnight', () => {
    mockGetTheme.mockReturnValue('dawn');
    mockIsDarkTheme.mockReturnValue(false);

    render(<ThemeToggle />);

    expect(screen.getByTestId('tooltip-label')).toHaveTextContent('Switch to Midnight mode');

    expect(screen.getByTestId('icon-moon')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-sun')).not.toBeInTheDocument();

    const btn = screen.getByRole('switch', { name: /toggle theme/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(btn);
    expect(mockSetTheme).toHaveBeenCalledWith('midnight');
  });

  test('onToggle prop overrides default: calls onToggle and does not call setTheme', () => {
    mockGetTheme.mockReturnValue('midnight');
    mockIsDarkTheme.mockReturnValue(true);

    const onToggle = jest.fn();
    render(<ThemeToggle onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('switch', { name: /toggle theme/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).not.toHaveBeenCalled();
  });
});
