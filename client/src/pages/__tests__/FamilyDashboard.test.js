import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

import FamilyDashboard from './FamilyDashboard.jsx';

// ---- Mocks ----

// Mock family API
jest.mock('../api/family', () => ({
  getMyFamily: jest.fn(),
  createFamilyInvite: jest.fn(),
}));
import { getMyFamily, createFamilyInvite } from '../api/family';

// Mock UserContext
const mockUseUser = jest.fn();
jest.mock('../context/UserContext', () => ({
  useUser: () => mockUseUser(),
}));

// Mock i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, defaultValue, options) => {
      // basic interpolation for {{role}} so "Owner" etc. show up nicely
      if (typeof defaultValue === 'string') {
        if (options && typeof options.role === 'string') {
          return defaultValue.replace('{{role}}', options.role);
        }
        return defaultValue;
      }
      return key;
    },
  }),
}));

// Mock react-router's useNavigate but keep the rest of the real exports
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Helper to wrap component with Mantine + Router
function renderWithProviders(ui, { route = '/family' } = {}) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FamilyDashboard', () => {
  test('redirects to login when not authenticated', async () => {
    mockUseUser.mockReturnValue({ currentUser: null });

    renderWithProviders(<FamilyDashboard />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?next=/family');
    });

    // Ensure we did not try to load family data
    expect(getMyFamily).not.toHaveBeenCalled();
  });

  test('shows "no family" empty state when API returns null', async () => {
    mockUseUser.mockReturnValue({ currentUser: { id: 1, email: 'user@example.com' } });

    getMyFamily.mockResolvedValueOnce(null);

    renderWithProviders(<FamilyDashboard />);

    // Initially shows loading state
    expect(
      screen.getByText('Loading your family details…')
    ).toBeInTheDocument();

    // After load: empty state message + CTA
    await waitFor(() => {
      expect(screen.getByText('No family set up yet')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'To create a Chatforia Family and shared data pool, purchase a Family pack from the Upgrade screen.'
      )
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: 'Go to Upgrade' })
    ).toBeInTheDocument();
  });

  test('renders family details and members when API returns a family', async () => {
    mockUseUser.mockReturnValue({ currentUser: { id: 1, email: 'owner@example.com' } });

    getMyFamily.mockResolvedValueOnce({
      id: 'fam_1',
      name: 'The Norton Family',
      role: 'OWNER',
      usedDataMb: 2048,   // 2.0 GB
      totalDataMb: 10240, // 10.0 GB
      members: [
        {
          id: 'm1',
          displayName: 'Julian',
          role: 'OWNER',
          usedDataMb: 1024,
          limitDataMb: null,
        },
        {
          id: 'm2',
          displayName: 'Guest',
          role: 'MEMBER',
          usedDataMb: 512,
          limitDataMb: 2048,
        },
      ],
    });

    renderWithProviders(<FamilyDashboard />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByText('Loading your family details…')).not.toBeInTheDocument();
    });

    // Title
    expect(screen.getByText('Family')).toBeInTheDocument();

    // Family name
    expect(screen.getByText('The Norton Family')).toBeInTheDocument();

    // Role text (rough check; depends on interpolation)
    expect(screen.getByText(/Your role:/)).toBeInTheDocument();

    // Shared data pool values (2.0 GB / 10.0 GB)
    expect(screen.getByText('2.0 GB / 10.0 GB')).toBeInTheDocument();

    // Members table rows
    expect(screen.getByText('Julian')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();

    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.getAllByText('Member')[0]).toBeInTheDocument();

    // Usage cells (formatted)
    expect(screen.getByText('1.0 GB')).toBeInTheDocument(); // Julian usedDataMb
    expect(screen.getByText('0.5 GB')).toBeInTheDocument(); // Guest usedDataMb
    expect(screen.getByText('No specific limit')).toBeInTheDocument(); // null limit
    expect(screen.getByText('2.0 GB')).toBeInTheDocument(); // Guest limitDataMb
  });

  test('creates an invite and shows the invite link', async () => {
    mockUseUser.mockReturnValue({ currentUser: { id: 1, email: 'owner@example.com' } });

    getMyFamily.mockResolvedValueOnce({
      id: 'fam_1',
      name: 'The Norton Family',
      role: 'OWNER',
      usedDataMb: 0,
      totalDataMb: 0,
      members: [],
    });

    createFamilyInvite.mockResolvedValueOnce({
      joinUrl: 'https://chatforia.app/family/join/abc123',
    });

    renderWithProviders(<FamilyDashboard />);

    await waitFor(() => {
      expect(screen.queryByText('Loading your family details…')).not.toBeInTheDocument();
    });

    // Fill in invite email
    const emailInput = screen.getByLabelText('Email (optional)');
    fireEvent.change(emailInput, { target: { value: 'friend@example.com' } });

    // Click "Create invite"
    const createBtn = screen.getByRole('button', { name: 'Create invite' });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(createFamilyInvite).toHaveBeenCalledWith({ email: 'friend@example.com' });
    });

    // After success, invite link is displayed
    await waitFor(() => {
      expect(
        screen.getByText('https://chatforia.app/family/join/abc123')
      ).toBeInTheDocument();
    });

    // Email input should be cleared
    expect(emailInput).toHaveValue('');
  });
});
