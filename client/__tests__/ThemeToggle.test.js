import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mocks ----

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    patch: jest.fn(() => Promise.resolve({ data: { theme: 'saved' } })),
  },
}));

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

  const useMantineColorScheme = () => ({
    setColorScheme: jest.fn(),
  });

  return {
    __esModule: true,
    ActionIcon,
    Tooltip,
    useMantineColorScheme,
  };
});

jest.mock('lucide-react', () => ({
  Sun: (props) => <span data-testid="icon-sun" {...props} />,
  Moon: (props) => <span data-testid="icon-moon" {...props} />,
}));

const mockGetTheme = jest.fn();
const mockSetTheme = jest.fn();
const mockIsDarkTheme = jest.fn();
const mockOnThemeChange = jest.fn(() => () => {});

jest.mock('@/utils/themeManager', () => ({
  __esModule: true,
  getTheme: (...args) => mockGetTheme(...args),
  setTheme: (...args) => mockSetTheme(...args),
  isDarkTheme: (...args) => mockIsDarkTheme(...args),
  onThemeChange: (...args) => mockOnThemeChange(...args),
}));

import ThemeToggle from '@/components/ThemeToggle';
import axiosClient from '@/api/axiosClient';

beforeEach(() => {
  jest.clearAllMocks();
  axiosClient.patch.mockResolvedValue({ data: { theme: 'saved' } });
});

describe('ThemeToggle', () => {
  test('dark-like theme: shows Sun icon, tooltip says switch to Dawn, aria-pressed=true; click sets theme to dawn', async () => {
    mockGetTheme.mockReturnValue('midnight');
    mockIsDarkTheme.mockReturnValue(true);

    render(<ThemeToggle />);

    expect(screen.getByTestId('tooltip-label')).toHaveTextContent(
      'Switch to Dawn mode'
    );

    expect(screen.getByTestId('icon-sun')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-moon')).not.toBeInTheDocument();

    const btn = screen.getByRole('switch', { name: /toggle theme/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(btn);

    expect(mockSetTheme).toHaveBeenCalledWith('dawn');

    await waitFor(() => {
      expect(axiosClient.patch).toHaveBeenCalledWith('/users/me', {
        theme: 'dawn',
      });
    });
  });

  test('light theme: shows Moon icon, tooltip says switch to Midnight, aria-pressed=false; click sets theme to midnight', async () => {
    mockGetTheme.mockReturnValue('dawn');
    mockIsDarkTheme.mockReturnValue(false);

    render(<ThemeToggle />);

    expect(screen.getByTestId('tooltip-label')).toHaveTextContent(
      'Switch to Midnight mode'
    );

    expect(screen.getByTestId('icon-moon')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-sun')).not.toBeInTheDocument();

    const btn = screen.getByRole('switch', { name: /toggle theme/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(btn);

    expect(mockSetTheme).toHaveBeenCalledWith('midnight');

    await waitFor(() => {
      expect(axiosClient.patch).toHaveBeenCalledWith('/users/me', {
        theme: 'midnight',
      });
    });
  });

  test('continues even if saving theme to backend fails', async () => {
    mockGetTheme.mockReturnValue('midnight');
    mockIsDarkTheme.mockReturnValue(true);
    axiosClient.patch.mockRejectedValueOnce(new Error('network fail'));

    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('switch', { name: /toggle theme/i }));

    expect(mockSetTheme).toHaveBeenCalledWith('dawn');

    await waitFor(() => {
      expect(axiosClient.patch).toHaveBeenCalledWith('/users/me', {
        theme: 'dawn',
      });
    });
  });
});