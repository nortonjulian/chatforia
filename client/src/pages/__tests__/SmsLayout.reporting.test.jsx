import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockSubmitReport = jest.fn();
const mockRefresh = jest.fn();
const mockNotificationsShow = jest.fn();

jest.mock('@mantine/notifications', () => ({
  notifications: {
    show: (...args) => mockNotificationsShow(...args),
  },
}));

const mockThread = {
  id: 19,
  contactPhone: '+15551234567',
  displayName: 'SMS QA',
  messages: [
    {
      id: 41,
      direction: 'out',
      body: 'Outgoing test message',
      mediaUrls: [],
      createdAt: '2026-11-01T11:59:00Z',
    },
    {
      id: 42,
      direction: 'in',
      body: 'Incoming suspicious message',
      mediaUrls: [],
      createdAt: '2026-11-01T12:00:00Z',
    },
  ],
};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ threadId: '19' }),
  useNavigate: () => mockNavigate,
}));

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/api/smsReporting', () => ({
  submitSmsMessageReport: (...args) => mockSubmitReport(...args),
}));

jest.mock('@/utils/smsThreadLive', () => ({
  createSmsThreadLoader: ({ onThread }) => ({
    refresh: () => {
      onThread(mockThread);
      return mockRefresh();
    },
    dispose: jest.fn(),
  }),
  subscribeSmsThread: () => jest.fn(),
}));

jest.mock('@/utils/smsMessagesStore.js', () => ({
  addSmsMessages: jest.fn(),
  searchSmsMessages: jest.fn(),
}));

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

jest.mock('@/hooks/useEntitlements', () => ({
  __esModule: true,
  default: () => ({ entitlements: {} }),
}));

jest.mock('@/hooks/useSmartReplies.js', () => ({
  useSmartReplies: () => ({
    suggestions: [],
    clear: jest.fn(),
  }),
}));

jest.mock('@/utils/prefsStore', () => ({
  getPref: jest.fn(async () => false),
  setPref: jest.fn(async () => {}),
  PREF_SMART_REPLIES: 'smartReplies',
}));

jest.mock('@/hooks/useTwilioVoice', () => ({
  useTwilioVoice: () => ({
    startBrowserCall: jest.fn(),
    hangup: jest.fn(),
    initializing: false,
    calling: false,
    callStatus: '',
    currentCall: null,
    error: null,
  }),
}));

jest.mock('@/threads/ThreadShell', () => ({
  __esModule: true,
  default: ({ header, composer, children }) => (
    <div>
      {header}
      {children}
      {composer}
    </div>
  ),
}));

jest.mock('@/threads/ThreadComposer.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="sms-composer" />,
}));

jest.mock('@/threads/ThreadActionsMenu.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/SmartReplyBar.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/sms/SmsMessageMedia', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/sms/SmsSearchDrawer.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/sms/SmsMediaGalleryModal.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/utils/buildSmsGalleryItems.js', () => ({
  buildSmsGalleryItems: () => [],
}));

jest.mock('@/components/sms/SmsReportModal.jsx', () => ({
  __esModule: true,
  default: ({
    opened,
    onSubmit,
    error,
    onBlockAfterReportChange,
  }) =>
    opened ? (
      <div role="dialog" aria-label="Report text message">
        {error && <p role="alert">{error}</p>}
        <button
          onClick={() => onBlockAfterReportChange(true)}
        >
          Enable blocking
        </button>
        <button onClick={onSubmit}>Submit report</button>
      </div>
    ) : null,
}));

import SmsLayout from '../SmsLayout.jsx';

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue();
  mockPost.mockResolvedValue({ data: { ok: true } });
  window.alert = jest.fn();
});

function mockSmsViewportGeometry() {
  const focus = jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  const geometry = jest.spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function () {
      if (this.classList?.contains('sms-thread-viewport')) {
        return { top: 0, bottom: 100, left: 0, right: 200 };
      }
      if (this.getAttribute?.('data-sms-msg-id') === '42') {
        return { top: 20, bottom: 50, left: 0, right: 200 };
      }
      return { top: 120, bottom: 150, left: 0, right: 200 };
    });
  return () => { geometry.mockRestore(); focus.mockRestore(); };
}

test('foreground SMS view acknowledges only its visible incoming row', async () => {
  const restore = mockSmsViewportGeometry();
  try {
    render(<SmsLayout currentUserId={7} currentUser={{ id: 7, plan: 'FREE' }} />);
    await screen.findByText('Incoming suspicious message');
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/sms/threads/19/read', {
        messageIds: [42],
      });
    }, { timeout: 2000 });
  } finally {
    restore();
  }
});

test('failed SMS acknowledgment retries on focus and refreshes after success', async () => {
  const restore = mockSmsViewportGeometry();
  const reload = jest.fn();
  window.addEventListener('sidebar:reload-rooms', reload);
  mockPost.mockRejectedValueOnce(new Error('synthetic offline'));
  try {
    render(<SmsLayout currentUserId={7} currentUser={{ id: 7, plan: 'FREE' }} />);
    await screen.findByText('Incoming suspicious message');
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(reload).not.toHaveBeenCalled();
    fireEvent.focus(window);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  } finally {
    window.removeEventListener('sidebar:reload-rooms', reload);
    restore();
  }
});

describe('SmsLayout reporting integration', () => {
  test('incoming messages expose Report', async () => {
    render(<SmsLayout currentUserId={7} currentUser={{ id: 7, plan: 'FREE' }} />);

    const incoming = await screen.findByText('Incoming suspicious message');
    const row = incoming.closest('[data-sms-msg-id]');

    expect(row).toBeTruthy();

    const menuButton = within(row).getByRole('button', {
      name: 'Message actions',
    });

    fireEvent.click(menuButton);

    expect(await screen.findByText('Report')).toBeInTheDocument();
  });

  test('submits the incoming message with zero context and no blocking', async () => {
    mockSubmitReport.mockResolvedValueOnce({
      id: 101,
      blockApplied: false,
    });

    render(<SmsLayout currentUserId={7} currentUser={{ id: 7, plan: 'FREE' }} />);

    const incoming = await screen.findByText('Incoming suspicious message');
    const row = incoming.closest('[data-sms-msg-id]');

    fireEvent.click(within(row).getByRole('button', {
      name: 'Message actions',
    }));

    fireEvent.click(within(row).getByText('Report'));

    fireEvent.click(screen.getByRole('button', {
      name: 'Submit report',
    }));

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalledWith(42, {
        reason: 'spam_scam',
        details: '',
        contextCount: 0,
        blockAfterReport: false,
      });
    });

    await waitFor(() => {
      expect(mockNotificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Report submitted',
          message:
            'Thank you for helping keep Chatforia safe. Our team will review your report.',
          color: 'green',
          withBorder: true,
          autoClose: 5000,
        })
      );
    });
  });

  test('reports and blocks only after the user opts in', async () => {
    mockSubmitReport.mockResolvedValueOnce({
      id: 102,
      blockApplied: true,
    });

    render(<SmsLayout currentUserId={7} currentUser={{ id: 7, plan: 'FREE' }} />);

    const incoming = await screen.findByText('Incoming suspicious message');
    const row = incoming.closest('[data-sms-msg-id]');

    fireEvent.click(within(row).getByRole('button', {
      name: 'Message actions',
    }));

    fireEvent.click(within(row).getByText('Report'));

    fireEvent.click(screen.getByRole('button', {
      name: 'Enable blocking',
    }));

    fireEvent.click(screen.getByRole('button', {
      name: 'Submit report',
    }));

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          blockAfterReport: true,
        })
      );
    });

    await waitFor(() => {
      expect(mockNotificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Report submitted',
          message:
            'Thank you for helping keep Chatforia safe. The phone number was also blocked.',
          color: 'green',
          withBorder: true,
          autoClose: 5000,
        })
      );
    });
  });

  test('keeps the dialog open when reporting fails', async () => {
    mockSubmitReport.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          message: 'You already reported this message',
        },
      },
    });

    render(<SmsLayout currentUserId={7} currentUser={{ id: 7, plan: 'FREE' }} />);

    const incoming = await screen.findByText('Incoming suspicious message');
    const row = incoming.closest('[data-sms-msg-id]');

    fireEvent.click(within(row).getByRole('button', {
      name: 'Message actions',
    }));

    fireEvent.click(within(row).getByText('Report'));

    fireEvent.click(screen.getByRole('button', {
      name: 'Submit report',
    }));

    expect(await screen.findByText('You already reported this message'))
      .toBeInTheDocument();

    expect(screen.getByRole('dialog', {
      name: 'Report text message',
    })).toBeInTheDocument();

    expect(window.alert).not.toHaveBeenCalled();
  });

  test('outgoing messages do not expose Report', async () => {
    render(<SmsLayout currentUserId={7} currentUser={{ id: 7, plan: 'FREE' }} />);

    const outgoing = await screen.findByText('Outgoing test message');
    const row = outgoing.closest('[data-sms-msg-id]');

    expect(row).toBeTruthy();

    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Message actions',
      })
    );

    expect(within(row).queryByText('Report'))
      .not.toBeInTheDocument();

    expect(within(row).getByText('Edit'))
      .toBeInTheDocument();

    expect(within(row).getByText('Delete'))
      .toBeInTheDocument();
  });
});
