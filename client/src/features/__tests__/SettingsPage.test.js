import { render, screen } from '@testing-library/react';

// ---- Mocks ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Stack = ({ children, ...props }) => (
    <div data-testid="stack" {...props}>{children}</div>
  );
  const Title = ({ children, order = 3, ...props }) => {
    const Tag = `h${order}`;
    return <Tag data-testid="title" {...props}>{children}</Tag>;
  };
  const Divider = (props) => <hr data-testid="divider" {...props} />;

  return { __esModule: true, Stack, Title, Divider };
});

// Child components
jest.mock('@/components/SoundSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="sound-settings" />,
}));
jest.mock('@/features/settings/ThemePicker', () => ({
  __esModule: true,
  default: () => <div data-testid="theme-picker" />,
}));
jest.mock('@/features/settings/PrivacyToggles', () => ({
  __esModule: true,
  default: () => <div data-testid="privacy-toggles" />,
}));
jest.mock('@/features/settings/AgeSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="age-settings" />,
}));
jest.mock('@/features/settings/ForwardingSettings.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="forwarding-settings" />,
}));

// SUT
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  test('renders sections, dividers, and child components', () => {
    render(<SettingsPage />);

    // Headings
    expect(screen.getByRole('heading', { name: /appearance/i, level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /notification sounds/i, level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /privacy/i, level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /safety &\s*age/i, level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /call &\s*text forwarding/i, level: 3 })).toBeInTheDocument();

    // Child components present once
    expect(screen.getByTestId('theme-picker')).toBeInTheDocument();
    expect(screen.getByTestId('sound-settings')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-toggles')).toBeInTheDocument();
    expect(screen.getByTestId('age-settings')).toBeInTheDocument();
    expect(screen.getByTestId('forwarding-settings')).toBeInTheDocument();

    // Divider count (between each section)
    const dividers = screen.getAllByTestId('divider');
    expect(dividers).toHaveLength(4);
  });
});
