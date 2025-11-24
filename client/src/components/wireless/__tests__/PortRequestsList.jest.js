import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import axios from 'axios';
import PortRequestsList from './PortRequestsList.jsx';

jest.mock('axios');

describe('PortRequestsList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows loading state initially', () => {
    axios.get.mockResolvedValueOnce({ data: [] });

    render(<PortRequestsList />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  test('shows error message when API call fails', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network error'));

    render(<PortRequestsList />);

    await waitFor(() => {
      expect(
        screen.getByText('Failed to load port requests.')
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No porting activity yet.')
    ).not.toBeInTheDocument();
  });

  test('shows empty state when there are no requests', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });

    render(<PortRequestsList />);

    await waitFor(() => {
      expect(
        screen.getByText('No porting activity yet.')
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  test('renders a list of porting requests with mapped statuses and dates', async () => {
    const createdAt = '2030-01-01T10:00:00.000Z';
    const scheduledAt = '2030-01-02T10:00:00.000Z';
    const completedAt = '2030-01-03T10:00:00.000Z';

    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 'req_1',
          phoneNumber: '+1 555 123 0001',
          status: 'PENDING',
          createdAt,
          scheduledAt: null,
          completedAt: null,
          statusReason: 'Waiting for account verification.',
        },
        {
          id: 'req_2',
          phoneNumber: '+1 555 123 0002',
          status: 'COMPLETED',
          createdAt,
          scheduledAt,
          completedAt,
          statusReason: null,
        },
      ],
    });

    render(<PortRequestsList />);

    // Wait for list to load
    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    });

    // Request 1
    expect(
      screen.getByText('+1 555 123 0001 · Pending review')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Waiting for account verification.')
    ).toBeInTheDocument();
    // Created date line – we just check that it starts with "Created:"
    expect(
      screen.getAllByText(/Created:/)[0]
    ).toBeInTheDocument();

    // Request 2
    expect(
      screen.getByText('+1 555 123 0002 · Completed')
    ).toBeInTheDocument();
    // Should render created, scheduled, and completed lines
    const createdLines = screen.getAllByText(/Created:/);
    const scheduledLines = screen.getAllByText(/Scheduled:/);
    const completedLines = screen.getAllByText(/Completed:/);

    expect(createdLines.length).toBeGreaterThanOrEqual(2);
    expect(scheduledLines.length).toBeGreaterThanOrEqual(1);
    expect(completedLines.length).toBeGreaterThanOrEqual(1);
  });

  test('falls back to raw status text when status is not in STATUS_LABELS', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 'req_unknown',
          phoneNumber: '+1 555 123 9999',
          status: 'SOME_NEW_STATUS',
          createdAt: '2030-01-01T10:00:00.000Z',
          scheduledAt: null,
          completedAt: null,
        },
      ],
    });

    render(<PortRequestsList />);

    await waitFor(() => {
      expect(
        screen.getByText('+1 555 123 9999 · SOME_NEW_STATUS')
      ).toBeInTheDocument();
    });
  });
});
