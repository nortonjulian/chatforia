/** @jest-environment jsdom */

import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils';

// ---- Mock react-router navigate ----
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ---- Dynamic UserContext mock (reads top-level mockUser) ----
let mockUser = null;
jest.mock('../src/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: mockUser }),
}));

// Import AFTER mocks
import PremiumGuard from '../src/components/PremiumGuard.jsx';

afterEach(() => {
  jest.clearAllMocks();
  mockUser = null;
});

test('renders children for premium user (plan: premium)', () => {
  mockUser = { plan: 'premium' };
  renderWithRouter(
    <PremiumGuard>
      <div>Child</div>
    </PremiumGuard>
  );
  expect(screen.getByText('Child')).toBeInTheDocument();
});

test('renders children for admin role regardless of plan', () => {
  mockUser = { plan: 'free', role: 'ADMIN' };
  renderWithRouter(
    <PremiumGuard>
      <div>Child</div>
    </PremiumGuard>
  );
  expect(screen.getByText('Child')).toBeInTheDocument();
});

test('inline variant shows alert-style note for free user', () => {
  mockUser = { plan: 'free' };
  renderWithRouter(
    <PremiumGuard variant="inline">
      <div>Child</div>
    </PremiumGuard>
  );
  // Should not show children, should show inline note with upgrade link text
  expect(screen.queryByText('Child')).toBeNull();

  // The component uses role="note", not "alert"
  expect(screen.getByRole('note')).toBeInTheDocument();
  expect(screen.getByText(/premium plan/i)).toBeInTheDocument();

  // Anchor exists with href to upgrade
  const link = screen.getByRole('link', { name: /upgrade/i });
  expect(link).toHaveAttribute('href', '/settings/upgrade');
});

test('default variant shows card with Upgrade CTA and navigates on click', async () => {
  mockUser = { plan: 'free' };
  renderWithRouter(
    <PremiumGuard>
      <div>Child</div>
    </PremiumGuard>
  );

  // Should render the premium guard card, not children
  expect(screen.getByTestId('premium-guard-card')).toBeInTheDocument();
  expect(screen.queryByText('Child')).toBeNull();

  // Button label is just "Upgrade" (with aria-label "Upgrade")
  const btn = screen.getByRole('button', { name: /upgrade/i });
  await userEvent.click(btn);
  expect(mockNavigate).toHaveBeenCalledWith('/settings/upgrade');
});

test('silent=true renders nothing for free user', () => {
  mockUser = { plan: 'free' };
  renderWithRouter(
    <PremiumGuard silent>
      <div>Child</div>
    </PremiumGuard>
  );

  // Nothing from card/alert/children
  expect(screen.queryByText('Child')).toBeNull();
  expect(screen.queryByRole('note')).toBeNull();
  expect(screen.queryByTestId('premium-guard-card')).toBeNull();
});
