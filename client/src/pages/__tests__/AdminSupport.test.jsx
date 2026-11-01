import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import AdminSupport from '../AdminSupport';

const mockGetSummary = jest.fn();
const mockGetTickets = jest.fn();
const mockUpdateTicket = jest.fn();

jest.mock('@/api/adminSupport', () => ({
  getSupportSummary: (...args) => mockGetSummary(...args),
  getSupportTickets: (...args) => mockGetTickets(...args),
  updateSupportTicket: (...args) => mockUpdateTicket(...args),
}));

const summary = {
  totals: {
    totalTickets: 1,
    openTickets: 1,
    escalatedTickets: 0,
    autoResolvedTickets: 0,
  },
  topCategories: [],
  topIssuesDetailed: [],
};

const tickets = {
  tickets: [{
    id: 77,
    email: 'customer@example.com',
    status: 'new',
    supportLevel: 'STANDARD',
    message: 'I need help with my account.',
  }],
};

function renderDashboard() {
  return render(
    <MantineProvider>
      <AdminSupport />
    </MantineProvider>
  );
}

describe('AdminSupport dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSummary.mockResolvedValue(summary);
    mockGetTickets.mockResolvedValue(tickets);
    mockUpdateTicket.mockResolvedValue({ ok: true });
  });

  test('loads and displays support tickets', async () => {
    renderDashboard();

    expect(await screen.findByText('customer@example.com'))
      .toBeInTheDocument();

    expect(screen.getByText('I need help with my account.'))
      .toBeInTheDocument();

    expect(mockGetSummary).toHaveBeenCalledTimes(1);
    expect(mockGetTickets).toHaveBeenCalledTimes(1);
  });

  test('displays error when initial loading fails', async () => {
    mockGetSummary.mockRejectedValueOnce(new Error('API unavailable'));

    renderDashboard();

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Unable to load support tickets');
  });

  test('displays error when ticket update fails', async () => {
    mockUpdateTicket.mockRejectedValueOnce(new Error('Update failed'));

    renderDashboard();

    await screen.findByText('customer@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Unable to update ticket');

    expect(mockUpdateTicket).toHaveBeenCalledWith(77, 'resolved');
  });

  test('refreshes tickets after successful update', async () => {
    renderDashboard();

    await screen.findByText('customer@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      expect(mockGetTickets).toHaveBeenCalledTimes(2);
    });

    expect(mockUpdateTicket).toHaveBeenCalledWith(77, 'resolved');
  });

  test('clears previous loading error after successful retry', async () => {
    mockGetSummary.mockRejectedValueOnce(new Error('Temporary failure'));

    renderDashboard();

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Unable to load support tickets');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('customer@example.com'))
      .toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
