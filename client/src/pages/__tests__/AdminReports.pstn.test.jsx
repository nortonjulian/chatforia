import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import AdminReportsPage from '../AdminReports.jsx';
import axiosClient from '../../api/axiosClient';

jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const pstnReport = {
  id: 101,
  reportType: 'PSTN',
  status: 'OPEN',
  reporter: {
    username: 'reporter',
    email: 'reporter@example.invalid',
  },
  reportedPhone: '+15551234567',
  smsMessageId: 42,
  reportedUserId: null,
  reportedUser: null,
  message: null,
  decryptedContent: 'Suspicious incoming text',
  reason: 'spam_scam',
  details: 'Potential phishing attempt',
  blockApplied: true,
  evidence: {
    contextCount: 1,
    contextMessages: [{
      id: 41,
      direction: 'in',
      text: 'Earlier suspicious text',
      mediaUrls: [],
      createdAt: '2026-11-01T11:59:00Z',
    }],
  },
  createdAt: '2026-11-01T12:00:00Z',
};

const appReport = {
  id: 102,
  reportType: 'APP',
  status: 'OPEN',
  reporter: {
    username: 'reporter2',
    email: 'reporter2@example.invalid',
  },
  reportedUserId: 77,
  reportedUser: {
    id: 77,
    username: 'reported-account',
    email: 'reported@example.invalid',
  },
  message: {
    id: 88,
    rawContent: 'Chatforia reported message',
    sender: {
      id: 77,
      username: 'reported-account',
    },
  },
  reason: 'harassment',
  blockApplied: false,
  createdAt: '2026-11-01T12:05:00Z',
};

function renderReports(items = [pstnReport]) {
  axiosClient.get.mockResolvedValue({
    data: {
      items,
      total: items.length,
    },
  });

  return render(
    <MantineProvider>
      <AdminReportsPage />
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AdminReports PSTN moderation', () => {
  test('identifies external SMS/MMS reports correctly', async () => {
    renderReports();

    expect(await screen.findByText('+15551234567'))
      .toBeInTheDocument();

    expect(screen.getByText('SMS/MMS'))
      .toBeInTheDocument();

    expect(screen.getByText('SMS Message ID: 42'))
      .toBeInTheDocument();

    expect(screen.getByText('Reporter blocked number'))
      .toBeInTheDocument();
  });

  test('disables account-specific actions for PSTN reports', async () => {
    renderReports();

    const phone = await screen.findByText('+15551234567');
    const row = phone.closest('tr');

    expect(row).toBeTruthy();

    for (const name of ['Warn', 'Ban', 'Delete Msg']) {
      expect(within(row).getByRole('button', { name }))
        .toBeDisabled();
    }

    expect(within(row).getByRole('button', { name: 'Resolve' }))
      .toBeEnabled();
  });

  test('shows voluntarily included evidence only after opening viewer', async () => {
    renderReports();

    await screen.findByText('+15551234567');

    expect(screen.queryByText('Earlier suspicious text'))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {
      name: 'View evidence',
    }));

    const evidenceDialog = screen.getByRole('dialog', {
      name: 'SMS/MMS report evidence',
    });

    expect(within(evidenceDialog).getByText('Earlier suspicious text'))
      .toBeInTheDocument();

    expect(within(evidenceDialog).getByText('Suspicious incoming text'))
      .toBeInTheDocument();
  });

  test('shows no previous context when none was submitted', async () => {
    renderReports([{
      ...pstnReport,
      evidence: {
        contextCount: 0,
        contextMessages: [],
      },
    }]);

    await screen.findByText('+15551234567');

    fireEvent.click(screen.getByRole('button', {
      name: 'View evidence',
    }));

    expect(screen.getByText(
      'No previous messages were included in this report.'
    )).toBeInTheDocument();
  });

  test('preserves Chatforia account moderation controls', async () => {
    renderReports([appReport]);

    const username = await screen.findByText('reported-account');
    const row = username.closest('tr');

    expect(row).toBeTruthy();

    expect(within(row).getByText('Chatforia'))
      .toBeInTheDocument();

    expect(within(row).getByRole('button', { name: 'Warn' }))
      .toBeDisabled();

    for (const name of ['Ban', 'Delete Msg']) {
      expect(within(row).getByRole('button', { name }))
        .toBeEnabled();
    }

    expect(within(row).queryByRole('button', {
      name: 'View evidence',
    })).not.toBeInTheDocument();
  });
});
