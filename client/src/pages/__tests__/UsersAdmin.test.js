import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ---- Mantine stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const passthru = (tid) => ({ children, ...p }) => (
    <div data-testid={tid} {...p}>{children}</div>
  );

  const Button = ({ children, onClick, disabled, ...p }) => (
    <button onClick={onClick} disabled={!!disabled} {...p}>{children}</button>
  );
  const TextInput = ({ value, onChange, placeholder }) => (
    <input
      aria-label={placeholder || 'input'}
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
  const Switch = ({ label, checked, onChange }) => (
    <label>
      {label}
      <input
        role="switch"
        aria-label={label}
        type="checkbox"
        checked={!!checked}
        onChange={() =>
          onChange?.({ currentTarget: { checked: !checked } })
        }
      />
    </label>
  );
  const Select = ({ value, data = [], onChange }) => (
    <div data-testid={`select-${value || 'unset'}`}>
      {data.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-testid={`opt-${opt.value}`}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const Table = Object.assign(
    ({ children, ...p }) => <table data-testid="table" {...p}><tbody>{children}</tbody></table>,
    {
      Thead: ({ children }) => <thead>{children}</thead>,
      Tbody: ({ children }) => <tbody>{children}</tbody>,
      Tr: ({ children }) => <tr>{children}</tr>,
      Th: ({ children }) => <th>{children}</th>,
      Td: ({ children }) => <td>{children}</td>,
    }
  );

  const Badge = ({ children }) => <span>{children}</span>;
  const Alert = ({ children }) => <div role="alert">{children}</div>;

  return {
    __esModule: true,
    Stack: passthru('stack'),
    Group: passthru('group'),
    Title: passthru('title'),
    TextInput,
    Button,
    Table,
    Badge,
    Switch,
    Select,
    Alert,
  };
});

// ---- axios client mock ----
const mockGet = jest.fn();
const mockPatch = jest.fn();
const mockPost = jest.fn();

jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    patch: (...a) => mockPatch(...a),
    post: (...a) => mockPost(...a),
  },
}));

// ---- SUT ----
import UsersAdminPage from '../UsersAdmin';

describe('UsersAdminPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetches users on mount and renders rows', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        items: [
          { id: 1, username: 'alice', email: 'a@x.com', role: 'USER', isBanned: false,
            allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
          { id: 2, username: 'bob', email: '', role: 'ADMIN', isBanned: true,
            allowExplicitContent: false, showOriginalWithTranslation: true, enableAIResponder: true, enableReadReceipts: true },
        ],
      },
    });

    render(<UsersAdminPage />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/admin/users', {
        params: { query: '', take: 50, skip: 0 },
      });
    });

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText(/Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Banned/i)).toBeInTheDocument();
  });

  test('search with query calls GET with that query', async () => {
    mockGet.mockResolvedValueOnce({ data: { items: [] } }); // initial
    mockGet.mockResolvedValueOnce({ data: { items: [] } }); // after search

    render(<UsersAdminPage />);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText(/Search…/i);
    fireEvent.change(input, { target: { value: 'ali' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => {
      expect(mockGet).toHaveBeenLastCalledWith('/admin/users', {
        params: { query: 'ali', take: 50, skip: 0 },
      });
    });
  });

  test('shows error alert when fetch fails', async () => {
    mockGet.mockRejectedValueOnce({ response: { data: { error: 'No auth' } } });

    render(<UsersAdminPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No auth');
    });
  });

  test('changing role calls PATCH and then refetches', async () => {
    // initial load
    mockGet.mockResolvedValueOnce({
      data: { items: [
        { id: 10, username: 'u', email: 'e', role: 'USER', isBanned: false,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
      ]},
    });
    // refetch after role change
    mockGet.mockResolvedValueOnce({ data: { items: [] } });
    mockPatch.mockResolvedValueOnce({ data: { ok: true } });

    render(<UsersAdminPage />);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('opt-ADMIN'));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/admin/users/10/role', { role: 'ADMIN' });
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  test('flag switches send correct payloads and refetch', async () => {
    const user = {
      id: 7,
      username: 'x',
      email: 'x',
      role: 'USER',
      isBanned: false,
      allowExplicitContent: true,
      showOriginalWithTranslation: false,
      enableAIResponder: false,
      enableReadReceipts: false,
    };

    // Initial load with one user
    mockGet.mockResolvedValueOnce({ data: { items: [user] } });
    // All subsequent refetches should keep the same user present
    mockGet.mockResolvedValue({ data: { items: [user] } });

    mockPatch.mockResolvedValue({ data: { ok: true } });

    render(<UsersAdminPage />);

    // Always (re)query switches with findByRole to survive re-renders
    const filterSwitch = await screen.findByRole('switch', { name: /Filter explicit/i });
    fireEvent.click(filterSwitch);
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/admin/users/7/flags', { allowExplicitContent: false });
    });

    const showOrigSwitch = await screen.findByRole('switch', { name: /Show Orig\+Trans/i });
    fireEvent.click(showOrigSwitch);
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/admin/users/7/flags', { showOriginalWithTranslation: true });
    });

    const aiReplySwitch = await screen.findByRole('switch', { name: /AI reply/i });
    fireEvent.click(aiReplySwitch);
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/admin/users/7/flags', { enableAIResponder: true });
    });

    const receiptsSwitch = await screen.findByRole('switch', { name: /Read receipts/i });
    fireEvent.click(receiptsSwitch);
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/admin/users/7/flags', { enableReadReceipts: true });
    });

    expect(mockGet).toHaveBeenCalled();
  });

  test('ban and unban actions hit the right endpoints and refetch', async () => {
    mockGet.mockResolvedValueOnce({
      data: { items: [
        { id: 1, username: 'a', email: 'a', role: 'USER', isBanned: false,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
        { id: 2, username: 'b', email: 'b', role: 'USER', isBanned: true,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
      ]},
    });
    // keep users present on refetch
    mockGet.mockResolvedValue({
      data: { items: [
        { id: 1, username: 'a', email: 'a', role: 'USER', isBanned: false,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
        { id: 2, username: 'b', email: 'b', role: 'USER', isBanned: true,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
      ]},
    });
    mockPost.mockResolvedValue({ data: { ok: true } });

    render(<UsersAdminPage />);

    // Wait for the specific action buttons instead of gating on username text
    const banBtn = await screen.findByRole('button', { name: /^Ban$/i });
    fireEvent.click(banBtn);
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/admin/users/1/ban');
    });

    const unbanBtn = await screen.findByRole('button', { name: /^Unban$/i });
    fireEvent.click(unbanBtn);
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/admin/users/2/unban');
    });

    expect(mockGet).toHaveBeenCalled();
  });
});
