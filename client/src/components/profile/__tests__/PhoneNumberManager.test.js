import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PhoneNumberManager from '../PhoneNumberManager.jsx'; // adjust to .js if needed

// -------------------- Mocks --------------------

// Mantine minimal stand-ins
jest.mock('@mantine/core', () => {
  const React = require('react');

  const wrap = (name) => ({ children, ...p }) => <div data-testid={name} {...p}>{children}</div>;

  const Alert = ({ children, color, withCloseButton, onClose, ...p }) => (
    <div role="alert" data-color={color} {...p}>
      {withCloseButton && <button aria-label="close-alert" onClick={onClose} />}
      {children}
    </div>
  );
  const Badge = ({ children, color, variant, leftSection, ...p }) => (
    <span role="status" data-variant={variant || ''} data-color={color || ''} {...p}>
      {leftSection ? <i data-testid="left-section" /> : null}
      {children}
    </span>
  );
  const Button = ({ children, onClick, disabled, ...p }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...p}>{children}</button>
  );
  const Card = wrap('card');
  const Divider = (p) => <hr role="separator" {...p} />;
  const Group = wrap('group');
  const Loader = (p) => <div role="progressbar" {...p} />;
  const Modal = ({ opened, onClose, title, children, ...p }) =>
    opened ? (
      <div role="dialog" aria-label={title} {...p}>
        <button aria-label="close-modal" onClick={onClose} style={{ display: 'none' }} />
        {children}
      </div>
    ) : null;
  const Select = ({ label, value, onChange, data, ...p }) => (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} {...p}>
        {data?.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label || d.value}
          </option>
        ))}
      </select>
    </label>
  );
  const Stack = wrap('stack');
  const Switch = ({ checked, onChange, label }) => (
    <label>
      {label}
      <input aria-label={label} type="checkbox" checked={checked} onChange={onChange} />
    </label>
  );
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;
  const TextInput = ({ label, value, onChange, placeholder, ...p }) => (
    <label>
      {label}
      <input aria-label={label} placeholder={placeholder} value={value} onChange={onChange} {...p} />
    </label>
  );
  const Title = ({ children }) => <h4>{children}</h4>;
  const Tooltip = ({ label, children }) => <div data-testid="tooltip" data-label={label}>{children}</div>;

  return {
    __esModule: true,
    Alert, Badge, Button, Card, Divider, Group, Loader, Modal, Select,
    Stack, Text, TextInput, Title, Switch, Tooltip,
  };
});

// Icons
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconAlertTriangle: () => <i />,
  IconCircleCheck: () => <i />,
  IconLock: () => <i />,
  IconLockOpen: () => <i />,
  IconPhone: () => <i />,
  IconReplace: () => <i />,
  IconSearch: () => <i />,
  IconTrash: () => <i />,
}));

// Router Link
jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ to, children, ...p }) => <a href={to} {...p}>{children}</a>,
}));

// useUser: control plan (mock-prefixed var so Jest allows closure)
let mockCurrentPlan = 'FREE';
// mock both alias & relative in case the component uses either
jest.mock('../../../context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: { id: 'me', plan: mockCurrentPlan } }),
}));
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: { id: 'me', plan: mockCurrentPlan } }),
}));

// axiosClient GET/POST: mock vars + inline factories
const mockAxiosGet = jest.fn();
const mockAxiosPost = jest.fn();

jest.mock('../../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockAxiosGet(...args),
    post: (...args) => mockAxiosPost(...args),
  },
}));
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockAxiosGet(...args),
    post: (...args) => mockAxiosPost(...args),
  },
}));

// Freeze time for expiring calculations
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  jest.clearAllMocks();
  mockCurrentPlan = 'FREE';
});
afterEach(() => {
  jest.useRealTimers();
});

// Confirm dialog
const confirmSpy = jest.spyOn(window, 'confirm');

// -------------------- Helpers --------------------
function mockStatus(data) {
  mockAxiosGet.mockResolvedValueOnce({ data });
}
function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: /pick a number/i }));
}

// -------------------- Tests --------------------
describe('PhoneNumberManager', () => {
  test('initial loading then "no number" state: shows Pick a number', async () => {
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    expect(await screen.findByText(/no number assigned/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick a number/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/no number/i);
  });

  test('active state: shows number, details, Replace & Release, Lock enabled (but premium gated)', async () => {
    mockStatus({
      state: 'active',
      e164: '+14155551234',
      display: '+1 415-555-1234',
      capabilities: ['sms', 'voice'],
      locked: false,
      expiresAt: '2025-02-10T00:00:00.000Z',
    });
    render(<PhoneNumberManager />);

    expect(await screen.findByText(/\(\d{3}\) \d{3}-\d{4}/)).toBeInTheDocument();
    expect(screen.getByText('+14155551234')).toBeInTheDocument();
    expect(screen.getByText('SMS')).toBeInTheDocument();
    expect(screen.getByText('VOICE')).toBeInTheDocument();
    expect(screen.getByText(/Not locked/i)).toBeInTheDocument();

    mockAxiosPost.mockRejectedValueOnce({ response: { status: 402 } });
    fireEvent.click(screen.getByRole('button', { name: /^lock$/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/premium feature/i);

    const upgrade = within(alert).getByRole('link', { name: /upgrade/i });
    expect(upgrade).toHaveAttribute('href', '/settings/upgrade');
  });

  test('expiring state: header badge with days tooltip', async () => {
    mockStatus({
      state: 'expiring',
      e164: '+14155550000',
      expiresAt: '2025-01-25T00:00:00.000Z', // 10 days from fixed "now"
      locked: false,
      capabilities: ['sms'],
    });
    render(<PhoneNumberManager />);

    await screen.findByText(/phone number/i);

    const tooltips = screen.getAllByTestId('tooltip');
    const expBadgeTooltip = tooltips.find(Boolean);
    expect(expBadgeTooltip.dataset.label).toMatch(/Expires in 10 days/i);
    expect(screen.getByRole('status')).toHaveTextContent(/Expiring \(10d\)/i);
  });

  test('unlock flow: calls /numbers/unlock and reloads with success banner', async () => {
    mockStatus({
      state: 'active',
      e164: '+18005550123',
      locked: true,
      capabilities: [],
      expiresAt: null,
    });
    render(<PhoneNumberManager />);

    await screen.findByText('+18005550123');

    const unlockBtn = screen.getByRole('button', { name: /unlock/i });
    mockAxiosPost.mockResolvedValueOnce({ data: { ok: true } }); // /numbers/unlock
    mockStatus({
      state: 'active',
      e164: '+18005550123',
      locked: false,
      capabilities: [],
      expiresAt: null,
    });

    fireEvent.click(unlockBtn);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number unlocked/i);
    fireEvent.click(within(alert).getByLabelText(/close-alert/i));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByText(/Not locked/i)).toBeInTheDocument();
  });

  test('lock success for PREMIUM user', async () => {
    mockCurrentPlan = 'PREMIUM';
    mockStatus({
      state: 'active',
      e164: '+18005550123',
      locked: false,
      capabilities: [],
    });
    render(<PhoneNumberManager />);

    await screen.findByText('+18005550123');

    mockAxiosPost.mockResolvedValueOnce({ data: { ok: true } }); // /numbers/lock
    mockStatus({
      state: 'active',
      e164: '+18005550123',
      locked: true,
      capabilities: [],
    });

    fireEvent.click(screen.getByRole('button', { name: /^lock$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number locked/i);
    expect(await screen.findByText(/Locked/i)).toBeInTheDocument();
  });

  test('lock disabled & tooltip when no active number', async () => {
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    const tooltip = screen.getByTestId('tooltip');
    expect(tooltip.dataset.label).toMatch(/assign a number first/i);

    const lockBtn = screen.getByRole('button', { name: /^lock$/i });
    expect(lockBtn).toBeDisabled();
  });

  test('release flow asks for confirm; posts when confirmed and shows banner, then reloads', async () => {
    mockStatus({
      state: 'active',
      e164: '+18005551212',
      locked: false,
      capabilities: [],
    });
    render(<PhoneNumberManager />);

    await screen.findByText('+18005551212');

    const confirmSpy = jest.spyOn(window, 'confirm');

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    expect(mockAxiosPost).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    mockAxiosPost.mockResolvedValueOnce({ data: { ok: true } }); // /numbers/release

    mockStatus({ state: 'none' });
    fireEvent.click(screen.getByRole('button', { name: /release/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number released/i);
    expect(await screen.findByText(/no number assigned/i)).toBeInTheDocument();
  });

  test('NumberPickerModal: search then assign closes modal, sets banner, and reloads', async () => {
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    openPicker();
    const dialog = await screen.findByRole('dialog', { name: /pick a number/i });

    mockAxiosGet.mockResolvedValueOnce({
      data: [{ id: 'num-1', e164: '+14155550001', capabilities: ['sms'], price: 3 }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /search/i }));

    // Match the number we actually mocked
    await within(dialog).findByText('+14155550001');

    mockAxiosPost
      .mockResolvedValueOnce({ data: { ok: true } }) // /numbers/reserve
      .mockResolvedValueOnce({ data: { ok: true } }); // /numbers/purchase

    mockStatus({
      state: 'active',
      e164: '+14155550001',
      locked: false,
      capabilities: ['sms'],
    });

    // Click "Select" inside the dialog
    fireEvent.click(within(dialog).getByRole('button', { name: /select/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number assigned/i);
    expect(await screen.findByText('+14155550001')).toBeInTheDocument();
  });

  test('NumberPickerModal: lock on assign passes lock=true to purchase', async () => {
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    openPicker();
    const dialog = await screen.findByRole('dialog', { name: /pick a number/i });

    const lockSwitch = within(dialog).getByLabelText(/lock this number/i);
    fireEvent.click(lockSwitch);

    mockAxiosGet.mockResolvedValueOnce({
      data: [{ id: 'num-2', e164: '+14155550002', capabilities: [] }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /search/i }));

    await within(dialog).findByText('+14155550002');

    mockAxiosPost
      .mockResolvedValueOnce({ data: { ok: true } }) // reserve
      .mockResolvedValueOnce({ data: { ok: true } }); // purchase

    mockStatus({
      state: 'active',
      e164: '+14155550002',
      locked: false,
      capabilities: [],
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /select/i }));

    await waitFor(() => {
      const call = mockAxiosPost.mock.calls.find((c) => c[0] === '/numbers/purchase');
      expect(call).toBeTruthy();
      expect(call[1]).toEqual({ numberId: 'num-2', lock: true });
    });
  });

  test('NumberPickerModal: search error and assign error show alert messages', async () => {
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    openPicker();
    const dialog = await screen.findByRole('dialog', { name: /pick a number/i });

    mockAxiosGet.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(within(dialog).getByRole('button', { name: /search/i }));

    await waitFor(() => expect(mockAxiosGet).toHaveBeenCalled());
    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent(/could not load available numbers/i);

    mockAxiosGet.mockResolvedValueOnce({
      data: [{ id: 'num-9', e164: '+14155550009', capabilities: [] }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /search/i }));
    await within(dialog).findByText('+14155550009');

    mockAxiosPost
      .mockResolvedValueOnce({ data: { ok: true } }) // reserve ok
      .mockRejectedValueOnce(new Error('purchase fail')); // purchase fails

    fireEvent.click(within(dialog).getByRole('button', { name: /select/i }));
    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent(/could not assign that number/i);
  });
});
