import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import PhoneNumberManager from '@/components/ProfileNumberManager'; // adjust path if necessary

// -------------------- Mocks --------------------

// Mantine core minimal stand-ins
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
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...p}
      >
        {data?.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label || d.value}
          </option>
        ))}
      </select>
    </label>
  );
  const Stack = wrap('stack');
  const Switch = ({ checked, onChange, label, onLabel, offLabel }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
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
    Alert, Badge, Button, Card, Divider, Group, Loader, Modal, Select,
    Stack, Text, TextInput, Title, Switch, Tooltip,
  };
});

// Icons (not used for behavior)
jest.mock('@tabler/icons-react', () => ({
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
  Link: ({ to, children, ...p }) => <a href={to} {...p}>{children}</a>,
}));

// useUser -> control plan for premium gating
let currentPlan = 'FREE';
jest.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: { id: 'me', plan: currentPlan } }),
}));

// axiosClient GET/POST
const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => getMock(...args),
    post: (...args) => postMock(...args),
  },
}));

// Freeze time for expiring calculations
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2025-01-15T12:00:00Z')); // fixed now
  jest.clearAllMocks();
  currentPlan = 'FREE';
});
afterEach(() => {
  jest.useRealTimers();
});

// Confirm dialog
const confirmSpy = jest.spyOn(window, 'confirm');

// -------------------- Helpers --------------------
function mockStatus(data) {
  getMock.mockResolvedValueOnce({ data });
}
function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: /pick a number/i }));
}
async function flush() {
  await Promise.resolve();
}

// -------------------- Tests --------------------
describe('PhoneNumberManager', () => {
  test('initial loading then "no number" state: shows Pick a number', async () => {
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    // Loading text while awaiting GET
    expect(await screen.findByText(/no number assigned/i)).toBeInTheDocument();

    // Primary CTA is Pick a number
    expect(screen.getByRole('button', { name: /pick a number/i })).toBeInTheDocument();

    // Header shows "No number" badge
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

    // Shows formatted local + e164
    expect(await screen.findByText(/\(\d{3}\) \d{3}-\d{4}/)).toBeInTheDocument();
    expect(screen.getByText('+14155551234')).toBeInTheDocument();

    // Capability badges + "Not locked"
    expect(screen.getByText('SMS')).toBeInTheDocument();
    expect(screen.getByText('VOICE')).toBeInTheDocument();
    expect(screen.getByText(/Not locked/i)).toBeInTheDocument();

    // Replace / Release visible
    expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /release/i })).toBeInTheDocument();

    // Lock button enabled (state is active), but user is FREE -> clicking shows premium warning banner
    postMock.mockRejectedValueOnce({ response: { status: 402 } }); // simulate server enforcing premium
    fireEvent.click(screen.getByRole('button', { name: /^lock$/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/premium feature/i);
    // upgrade button points to upgrade
    const upgrade = within(alert).getByRole('link', { name: /upgrade/i });
    expect(upgrade).toHaveAttribute('href', '/settings/upgrade');
  });

  test('expiring state: header badge with days tooltip', async () => {
    // expiresAt ~ 10 days ahead (Jan 25)
    mockStatus({
      state: 'expiring',
      e164: '+14155550000',
      expiresAt: '2025-01-25T00:00:00.000Z',
      locked: false,
      capabilities: ['sms'],
    });
    render(<PhoneNumberManager />);

    // Wait for header to render
    await screen.findByText(/phone number/i);

    // Header badge shows "Expiring (Xd)" and tooltip has label with pluralization
    const tooltips = screen.getAllByTestId('tooltip');
    const expBadgeTooltip = tooltips.find(Boolean);
    expect(expBadgeTooltip.dataset.label).toMatch(/Expires in 10 days/i);

    // The badge text includes the shorthand too (10d)
    expect(screen.getByRole('status')).toHaveTextContent(/Expiring \(10d\)/i);
  });

  test('unlock flow: shows Unlock when locked=true; clicking calls /numbers/unlock and reloads with success banner', async () => {
    // First load -> active & locked
    mockStatus({
      state: 'active',
      e164: '+18005550123',
      locked: true,
      capabilities: [],
      expiresAt: null,
    });
    render(<PhoneNumberManager />);

    await screen.findByText('+18005550123');

    // Unlock button visible
    const unlockBtn = screen.getByRole('button', { name: /unlock/i });
    postMock.mockResolvedValueOnce({ data: { ok: true } }); // /numbers/unlock
    // After unlock we reload status:
    mockStatus({
      state: 'active',
      e164: '+18005550123',
      locked: false,
      capabilities: [],
      expiresAt: null,
    });

    fireEvent.click(unlockBtn);

    // Success banner appears then clears on close
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number unlocked/i);
    fireEvent.click(within(alert).getByLabelText(/close-alert/i));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Reload happened (second status rendered shows Not locked)
    expect(await screen.findByText(/Not locked/i)).toBeInTheDocument();
  });

  test('lock success for PREMIUM user: posts /numbers/lock and reloads with success banner', async () => {
    currentPlan = 'PREMIUM';
    mockStatus({
      state: 'active',
      e164: '+18005550123',
      locked: false,
      capabilities: [],
    });
    render(<PhoneNumberManager />);

    await screen.findByText('+18005550123');

    postMock.mockResolvedValueOnce({ data: { ok: true } }); // /numbers/lock
    // Reload status after lock:
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

    // Lock button shows tooltip "Assign a number first" and is disabled
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

    // Cancel first
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    expect(postMock).not.toHaveBeenCalled();

    // Confirm second
    confirmSpy.mockReturnValueOnce(true);
    postMock.mockResolvedValueOnce({ data: { ok: true } }); // /numbers/release

    mockStatus({ state: 'none' });
    fireEvent.click(screen.getByRole('button', { name: /release/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number released/i);

    // After reload, "No number" view
    expect(await screen.findByText(/no number assigned/i)).toBeInTheDocument();
  });

  test('NumberPickerModal: search then assign (reserve → purchase) closes modal, sets banner, and reloads', async () => {
    // Start with none
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    // Open picker
    openPicker();
    const dialog = await screen.findByRole('dialog', { name: /pick a number/i });

    // Search returns results
    getMock.mockResolvedValueOnce({
      data: [{ id: 'num-1', e164: '+14155550001', capabilities: ['sms'], price: 3 }],
    }); // /numbers/search
    fireEvent.click(within(dialog).getByRole('button', { name: /search/i }));

    await screen.findByText(/\+14155550001/);

    // Reserve (best-effort) and Purchase succeed
    postMock
      .mockResolvedValueOnce({ data: { ok: true } }) // /numbers/reserve
      .mockResolvedValueOnce({ data: { ok: true } }); // /numbers/purchase

    // After assign, modal closes; outer shows success banner; reload status becomes active
    mockStatus({
      state: 'active',
      e164: '+14155550001',
      locked: false,
      capabilities: ['sms'],
    });

    fireEvent.click(screen.getByRole('button', { name: /select/i }));

    // Success banner
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number assigned/i);
    // Active details
    expect(await screen.findByText('+14155550001')).toBeInTheDocument();
  });

  test('NumberPickerModal: lock on assign flag passes lock=true to purchase', async () => {
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    openPicker();
    const dialog = await screen.findByRole('dialog', { name: /pick a number/i });

    // Toggle lock
    const lockSwitch = within(dialog).getByLabelText(/lock this number/i);
    fireEvent.click(lockSwitch);

    // Search
    getMock.mockResolvedValueOnce({
      data: [{ id: 'num-2', e164: '+14155550002', capabilities: [] }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /search/i }));
    await screen.findByText('+14155550002');

    // Reserve + Purchase (expect lock: true)
    postMock
      .mockResolvedValueOnce({ data: { ok: true } }) // reserve
      .mockResolvedValueOnce({ data: { ok: true } }); // purchase

    // Next status after purchase
    mockStatus({
      state: 'active',
      e164: '+14155550002',
      locked: false,
      capabilities: [],
    });

    fireEvent.click(screen.getByRole('button', { name: /select/i }));

    await waitFor(() => {
      // Find the last post call to /numbers/purchase with lock true
      const call = postMock.mock.calls.find((c) => c[0] === '/numbers/purchase');
      expect(call).toBeTruthy();
      expect(call[1]).toEqual({ numberId: 'num-2', lock: true });
    });
  });

  test('NumberPickerModal: search error and assign error show alert messages', async () => {
    mockStatus({ state: 'none' });
    render(<PhoneNumberManager />);

    openPicker();
    const dialog = await screen.findByRole('dialog', { name: /pick a number/i });

    // Search error
    getMock.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(within(dialog).getByRole('button', { name: /search/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load available numbers/i);

    // Successful search then assign error
    getMock.mockResolvedValueOnce({
      data: [{ id: 'num-9', e164: '+14155550009', capabilities: [] }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /search/i }));
    await screen.findByText('+14155550009');

    postMock
      .mockResolvedValueOnce({ data: { ok: true } }) // reserve ok (even if best-effort)
      .mockRejectedValueOnce(new Error('purchase fail')); // purchase fails

    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not assign that number/i);
  });
});
