import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

// ---- Mocks ----

// Mock API
jest.mock('../api/family', () => ({
  joinFamily: jest.fn(),
}));
import { joinFamily } from '../api/family';

// Mock UserContext
const mockUseUser = jest.fn();
jest.mock('../context/UserContext', () => ({
  useUser: () => mockUseUser(),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, defaultValue) => defaultValue || key,
  }),
}));

// Mock react-router-dom's useNavigate, but keep everything else real
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import FamilyJoin from './FamilyJoin.jsx';

// Helper: render with router + Mantine, including proper route pattern
function renderWithRoute(ui, { route = '/family/join/test-token', path = '/family/join/:token' } = {}) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FamilyJoin', () => {
  test('redirects to login when not authenticated', async () => {
    mockUseUser.mockReturnValue({ currentUser: null });

    renderWithRoute(<FamilyJoin />, {
      route: '/family/join/abc123',
      path: '/family/join/:token',
    });

    // Button should say "Sign in and join family"
    const button = screen.getByRole('button', { name: 'Sign in and join family' });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?next=/family/join/abc123');
    });

    expect(joinFamily).not.toHaveBeenCalled();
  });

  test('joins family successfully when logged in', async () => {
    mockUseUser.mockReturnValue({ currentUser: { id: 1, email: 'user@example.com' } });
    joinFamily.mockResolvedValueOnce({});

    renderWithRoute(<FamilyJoin />, {
      route: '/family/join/xyz789',
      path: '/family/join/:token',
    });

    // Button should say "Accept and join family"
    const button = screen.getByRole('button', { name: 'Accept and join family' });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() => {
      expect(joinFamily).toHaveBeenCalledWith('xyz789');
    });

    // After success, show success message and "Go to family dashboard" button
    await waitFor(() => {
      expect(
        screen.getByText('You have joined this family. You now share their data pool.')
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: 'Go to family dashboard' })
    ).toBeInTheDocument();
  });

  test('shows error when joinFamily fails', async () => {
    mockUseUser.mockReturnValue({ currentUser: { id: 1, email: 'user@example.com' } });
    joinFamily.mockRejectedValueOnce(new Error('invite expired'));

    renderWithRoute(<FamilyJoin />, {
      route: '/family/join/errtok',
      path: '/family/join/:token',
    });

    const button = screen.getByRole('button', { name: 'Accept and join family' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(joinFamily).toHaveBeenCalledWith('errtok');
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          'We could not add you to this family. The invite may be invalid or expired.'
        )
      ).toBeInTheDocument();
    });

    // Still on the pre-join view (no success text yet)
    expect(
      screen.queryByText('You have joined this family. You now share their data pool.')
    ).not.toBeInTheDocument();
  });
});
