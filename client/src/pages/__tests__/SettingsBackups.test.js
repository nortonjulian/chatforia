import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@mantine/core', () => {
  const clean = ({ gap, c, mt, ...props }) => props;
  return {
    Stack: ({ children, ...props }) => <div {...clean(props)}>{children}</div>,
    Text: ({ children, ...props }) => <div {...clean(props)}>{children}</div>,
    Title: ({ children, order = 3, ...props }) => {
      const Tag = `h${order}`;
      return <Tag {...clean(props)}>{children}</Tag>;
    },
  };
});

jest.mock('../../components/settings/ChatBackupManager.jsx', () => ({
  __esModule: true,
  default: ({ fetchPage }) => (
    <div data-testid="chat-backup-manager">
      <button type="button" onClick={fetchPage}>Export</button>
    </div>
  ),
}));

import SettingsBackups from '../SettingsBackups';

describe('SettingsBackups', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('renders the chat-history backup page and manager', () => {
    render(<SettingsBackups />);

    expect(
      screen.getByRole('heading', { name: 'Chat History Backups', level: 3 })
    ).toBeInTheDocument();
    expect(screen.getByText(/Export encrypted copies/i)).toBeInTheDocument();
    expect(screen.getByTestId('chat-backup-manager')).toBeInTheDocument();
  });

  test('supplies a message fetcher that returns JSON', async () => {
    const payload = { items: [] };
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payload),
    });

    render(<SettingsBackups />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/messages/all?limit=5000', {
        credentials: 'include',
      });
    });
  });

});
