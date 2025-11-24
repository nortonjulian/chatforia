const { render, screen, fireEvent, waitFor } = require('@testing-library/react');
const React = require('react');

// ---- Mock i18next ----
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts && typeof opts.count !== 'undefined') {
        return `${key}(${opts.count})`;
      }
      return key;
    },
  }),
}));

// ---- Mock API layer (for interactions that call setVoicemailRead/deleteVoicemail) ----
const mockFetchVoicemails = jest.fn();
const mockSetVoicemailRead = jest.fn();
const mockDeleteVoicemail = jest.fn();

jest.mock('@/api/voicemailApi.js', () => ({
  __esModule: true,
  fetchVoicemails: (...args) => mockFetchVoicemails(...args),
  setVoicemailRead: (...args) => mockSetVoicemailRead(...args),
  deleteVoicemail: (...args) => mockDeleteVoicemail(...args),
}));

// ---- Mock VoicemailPlayer to keep things simple ----
jest.mock('../VoicemailPlayer.jsx', () => ({
  __esModule: true,
  default: ({ voicemail }) => (
    <div data-testid="voicemail-player">Player for {voicemail?.id}</div>
  ),
}));

// ---- SUT import (after mocks) ----
const { default: VoicemailList } = require('../VoicemailList.jsx');

describe('VoicemailList (with injected initial state)', () => {
  const originalConfirm = global.confirm;
  const originalAlert = global.alert;

  beforeEach(() => {
    jest.clearAllMocks();
    global.confirm = jest.fn().mockReturnValue(true);
    global.alert = jest.fn();
  });

  afterAll(() => {
    global.confirm = originalConfirm;
    global.alert = originalAlert;
  });

  test('renders list and selects first voicemail by default', () => {
    const voicemails = [
      {
        id: 'v1',
        fromNumber: '+15550001',
        toNumber: '+15559999',
        isRead: false,
        durationSec: 30,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'v2',
        fromNumber: '+15550002',
        toNumber: '+15559999',
        isRead: true,
        durationSec: 60,
        createdAt: '2024-01-02T00:00:00.000Z',
      },
    ];

    render(<VoicemailList initialVoicemails={voicemails} />);

    // No loading state because we injected initial voicemails
    expect(screen.queryByText('voicemail.loading')).toBeNull();

    // Both numbers are shown
    expect(screen.getByText('+15550001')).toBeInTheDocument();
    expect(screen.getByText('+15550002')).toBeInTheDocument();

    // Player is rendered for the first voicemail by default
    expect(screen.getByTestId('voicemail-player')).toHaveTextContent('v1');

    // Unread dot present for the unread voicemail
    expect(
      screen.getByLabelText('voicemail.unreadDotAria')
    ).toBeInTheDocument();

    // Duration text via t('voicemail.durationSeconds', { count })
    expect(
      screen.getByText('voicemail.durationSeconds(30)', { exact: false })
    ).toBeInTheDocument();
  });

  test('shows empty state when there are no voicemails', () => {
    render(<VoicemailList initialVoicemails={[]} />);

    expect(screen.getByText('voicemail.empty')).toBeInTheDocument();
  });

  test('shows error state when initialError is provided', () => {
    render(<VoicemailList initialError="voicemail.errorLoading" />);

    expect(
      screen.getByText('voicemail.errorLoading')
    ).toBeInTheDocument();
  });

  test('selecting a voicemail marks it read when not already read', async () => {
    const voicemails = [
      {
        id: 'v1',
        fromNumber: '+15550001',
        isRead: false,
        durationSec: 30,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    mockSetVoicemailRead.mockResolvedValueOnce();

    render(<VoicemailList initialVoicemails={voicemails} />);

    const item = screen.getByText('+15550001');
    const button = item.closest('button');
    expect(button).toBeTruthy();

    // Click the list item (calls handleSelect which should mark read)
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockSetVoicemailRead).toHaveBeenCalledWith('v1', true);
    });

    // After marking read, unread dot should disappear
    await waitFor(() => {
      expect(
        screen.queryByLabelText('voicemail.unreadDotAria')
      ).toBeNull();
    });
  });

  test('delete button calls deleteVoicemail and removes item', async () => {
    const voicemails = [
      {
        id: 'v1',
        fromNumber: '+15550001',
        isRead: true,
        durationSec: 30,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'v2',
        fromNumber: '+15550002',
        isRead: true,
        durationSec: 45,
        createdAt: '2024-01-02T00:00:00.000Z',
      },
    ];

    mockDeleteVoicemail.mockResolvedValueOnce();

    render(<VoicemailList initialVoicemails={voicemails} />);

    // Active is first: v1
    expect(screen.getByTestId('voicemail-player')).toHaveTextContent('v1');

    const deleteButton = screen.getByText('voicemail.delete');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockDeleteVoicemail).toHaveBeenCalledWith('v1');
    });

    // v1 should be gone, v2 should still be present and now active
    expect(screen.queryByText('+15550001')).toBeNull();
    expect(screen.getByText('+15550002')).toBeInTheDocument();
    expect(screen.getByTestId('voicemail-player')).toHaveTextContent('v2');
  });

  test('does not delete when user cancels confirm', async () => {
    global.confirm = jest.fn().mockReturnValue(false);

    const voicemails = [
      {
        id: 'v1',
        fromNumber: '+15550001',
        isRead: true,
        durationSec: 30,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    render(<VoicemailList initialVoicemails={voicemails} />);

    const deleteButton = screen.getByText('voicemail.delete');
    fireEvent.click(deleteButton);

    expect(mockDeleteVoicemail).not.toHaveBeenCalled();
    // Still present
    expect(screen.getByText('+15550001')).toBeInTheDocument();
  });
});
