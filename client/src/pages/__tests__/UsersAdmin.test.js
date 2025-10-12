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
  // Minimal Select: renders two options and calls onChange(value)
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

  // Table shim
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
const getMock = jest.fn();
const patchMock = jest.fn();
const postMock = jest.fn();
jest.mock('../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => getMock(...a),
    patch: (...a) => patchMock(...a),
    post: (...a) => postMock(...a),
  },
}));

// ---- SUT ----
import UsersAdminPage from './UsersAdmin';

describe('UsersAdminPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetches users on mount and renders rows', async () => {
    getMock.mockResolvedValueOnce({
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
      expect(getMock).toHaveBeenCalledWith('/admin/users', {
        params: { query: '', take: 50, skip: 0 },
      });
    });

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText(/Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Banned/i)).toBeInTheDocument();
  });

  test('search with query calls GET with that query', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [] } }); // initial
    getMock.mockResolvedValueOnce({ data: { items: [] } }); // after search

    render(<UsersAdminPage />);

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText(/Search…/i);
    fireEvent.change(input, { target: { value: 'ali' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    await waitFor(() => {
      expect(getMock).toHaveBeenLastCalledWith('/admin/users', {
        params: { query: 'ali', take: 50, skip: 0 },
      });
    });
  });

  test('shows error alert when fetch fails', async () => {
    getMock.mockRejectedValueOnce({ response: { data: { error: 'No auth' } } });

    render(<UsersAdminPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No auth');
    });
  });

  test('changing role calls PATCH and then refetches', async () => {
    // initial load
    getMock.mockResolvedValueOnce({
      data: { items: [
        { id: 10, username: 'u', email: 'e', role: 'USER', isBanned: false,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
      ]},
    });
    // refetch after role change
    getMock.mockResolvedValueOnce({ data: { items: [] } });
    patchMock.mockResolvedValueOnce({ data: { ok: true } });

    render(<UsersAdminPage />);

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    // Click ADMIN option on the select
    fireEvent.click(screen.getByTestId('opt-ADMIN'));

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/admin/users/10/role', { role: 'ADMIN' });
      // refetch called
      expect(getMock).toHaveBeenCalledTimes(2);
    });
  });

  test('flag switches send correct payloads and refetch', async () => {
    // User initial flags:
    // allowExplicitContent: true  -> "Filter explicit" switch is unchecked
    // showOriginalWithTranslation: false
    // enableAIResponder: false
    // enableReadReceipts: false
    getMock.mockResolvedValueOnce({
      data: { items: [
        { id: 7, username: 'x', email: 'x', role: 'USER', isBanned: false,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
      ]},
    });
    // After each flag change, component refetches. We'll just resolve all next GETs.
    getMock.mockResolvedValue({ data: { items: [] } });

    patchMock.mockResolvedValue({ data: { ok: true } });

    render(<UsersAdminPage />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    // Filter explicit: toggling will set checked -> true, payload allowExplicitContent: !true = false
    fireEvent.click(screen.getByRole('switch', { name: /Filter explicit/i }));
    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/admin/users/7/flags', { allowExplicitContent: false });
    });

    // Show Orig+Trans: starts false, toggle -> true
    fireEvent.click(screen.getByRole('switch', { name: /Show Orig\+Trans/i }));
    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/admin/users/7/flags', { showOriginalWithTranslation: true });
    });

    // AI reply: starts false, toggle -> true
    fireEvent.click(screen.getByRole('switch', { name: /AI reply/i }));
    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/admin/users/7/flags', { enableAIResponder: true });
    });

    // Read receipts: starts false, toggle -> true
    fireEvent.click(screen.getByRole('switch', { name: /Read receipts/i }));
    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/admin/users/7/flags', { enableReadReceipts: true });
    });

    // Multiple refetches happened
    expect(getMock).toHaveBeenCalled();
  });

  test('ban and unban actions hit the right endpoints and refetch', async () => {
    // First user not banned, second banned
    getMock.mockResolvedValueOnce({
      data: { items: [
        { id: 1, username: 'a', email: 'a', role: 'USER', isBanned: false,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
        { id: 2, username: 'b', email: 'b', role: 'USER', isBanned: true,
          allowExplicitContent: true, showOriginalWithTranslation: false, enableAIResponder: false, enableReadReceipts: false },
      ]},
    });
    // Refetch(es)
    getMock.mockResolvedValue({ data: { items: [] } });

    postMock.mockResolvedValue({ data: { ok: true } });

    render(<UsersAdminPage />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    // Ban first
    fireEvent.click(screen.getByRole('button', { name: /Ban/i }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/admin/users/1/ban');
    });

    // Unban second
    fireEvent.click(screen.getByRole('button', { name: /Unban/i }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/admin/users/2/unban');
    });

    // Refetch happened multiple times
    expect(getMock).toHaveBeenCalled();
  });
});
