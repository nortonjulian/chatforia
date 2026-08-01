import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import LinkedDevicesPanel from '@/components/LinkedDevicesPanel';

jest.mock('@mantine/core', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  const Button = ({ children, onClick, disabled, loading, type = 'button' }) => (
    <button type={type} onClick={onClick} disabled={disabled || loading}>{children}</button>
  );
  return {
    Alert: ({ children, title }) => <div role="alert" aria-label={title}>{children}</div>,
    Badge: ({ children }) => <span>{children}</span>,
    Button,
    Card: Wrapper,
    Group: Wrapper,
    Stack: Wrapper,
    Text: Wrapper,
    Skeleton: () => <div role="progressbar" />,
    Tooltip: Wrapper,
    ActionIcon: ({ children, onClick, 'aria-label': label }) => (
      <button type="button" onClick={onClick} aria-label={label}>{children}</button>
    ),
    Modal: ({ opened, children, title }) =>
      opened ? <div role="dialog" aria-label={title}>{children}</div> : null,
    TextInput: ({ label, value, onChange, ...props }) => (
      <label>
        {label}
        <input aria-label={label} value={value || ''} onChange={onChange} {...props} />
      </label>
    ),
  };
});

jest.mock('@tabler/icons-react', () => {
  const Icon = () => <span />;

  return {
    IconDeviceLaptop: Icon,
    IconDeviceMobile: Icon,
    IconPencil: Icon,
    IconRefresh: Icon,
    IconTrash: Icon,
  };
});

const mockShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  notifications: { show: (...args) => mockShow(...args) },
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

jest.mock('@/context/UserContext', () => ({
  useUser: () => ({ needsKeyUnlock: false }),
}));

jest.mock('@/utils/browserDeviceClient', () => ({
  getBrowserDeviceRecord: jest.fn().mockResolvedValue(null),
}));

jest.mock('react-i18next', () => {
  const t = (_key, fallback, vars) => {
    if (!vars) return fallback || _key;

    return Object.entries(vars).reduce(
      (text, [name, value]) => {
        return text.replace(`{{${name}}}`, value);
      },
      fallback || _key
    );
  };

  return {
    useTranslation: () => ({ t }),
  };
});

describe('LinkedDevicesPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads devices, shows initial skeletons, and supports refresh', async () => {
    let resolveInitial;
    mockGet.mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }));
    render(<LinkedDevicesPanel />);

    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    resolveInitial({ data: { items: [] } });
    expect(await screen.findByText(/No other registered devices/i)).toBeInTheDocument();

    mockGet.mockResolvedValueOnce({ data: { items: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(mockGet).toHaveBeenCalledWith('/devices/mine');
  });

  test('shows the server error when loading devices fails', async () => {
    mockGet.mockRejectedValueOnce({ response: { data: { error: 'Not found' } } });
    render(<LinkedDevicesPanel />);
    expect(await screen.findByRole('alert', { name: /Devices could not be loaded/i }))
      .toHaveTextContent('Not found');
  });

  test('renders devices and renames one through the modal', async () => {
    mockGet.mockResolvedValueOnce({
      data: { items: [{ deviceId: 'dev-1', name: 'MacBook Pro', platform: 'macOS' }] },
    });
    render(<LinkedDevicesPanel />);
    await screen.findByText('MacBook Pro');

    fireEvent.click(screen.getByRole('button', { name: 'Rename device' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename device' });
    fireEvent.change(within(dialog).getByLabelText('Device name'), {
      target: { value: 'Work Mac' },
    });
    mockPost.mockResolvedValueOnce({ data: { ok: true } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/devices/rename', {
        deviceId: 'dev-1',
        name: 'Work Mac',
      });
    });
    expect(await screen.findByText('Work Mac')).toBeInTheDocument();
    expect(mockShow).toHaveBeenCalledWith({ color: 'green', message: 'Device renamed.' });
  });

  test('removes a device after confirmation', async () => {
    mockGet.mockResolvedValueOnce({
      data: { items: [{ deviceId: 'dev-2', name: 'Pixel', platform: 'Android' }] },
    });
    render(<LinkedDevicesPanel />);
    await screen.findByText('Pixel');
    fireEvent.click(screen.getByRole('button', { name: 'Remove device' }));

    const dialog = screen.getByRole('dialog', { name: 'Remove this device?' });
    mockPost.mockResolvedValueOnce({ data: { ok: true } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove device' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/devices/revoke', { deviceId: 'dev-2' });
    });
    expect(screen.queryByText('Pixel')).not.toBeInTheDocument();
  });
});
