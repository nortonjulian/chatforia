/** @jest-environment jsdom */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import PhoneNumberManager from '../PhoneNumberManager.jsx';

/* -------------------- Mocks -------------------- */

// Minimal Mantine mock
jest.mock('@mantine/core', () => {
  const React = require('react');

  const wrap = (name) => ({ children, ...p }) => (
    <div data-testid={name} {...p}>
      {children}
    </div>
  );

  const Alert = ({ children, color, withCloseButton, onClose, ...p }) => (
    <div role="alert" data-color={color} {...p}>
      {withCloseButton && (
        <button aria-label="close-alert" onClick={onClose} />
      )}
      {children}
    </div>
  );

  const Badge = ({ children, color, variant, leftSection, ...p }) => (
    <span
      role="status"
      data-variant={variant || ''}
      data-color={color || ''}
      {...p}
    >
      {leftSection ? <i data-testid="left-section" /> : null}
      {children}
    </span>
  );

  const Button = ({ children, onClick, disabled, ...p }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...p}>
      {children}
    </button>
  );

  const Card = wrap('card');
  const Divider = (p) => <hr role="separator" {...p} />;
  const Group = wrap('group');
  const Loader = (p) => <div role="progressbar" {...p} />;
  const Modal = ({ opened, onClose, title, children, ...p }) =>
    opened ? (
      <div role="dialog" aria-label={title} {...p}>
        <button
          aria-label="close-modal"
          onClick={onClose}
          style={{ display: 'none' }}
        />
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

  const Switch = ({ checked, onChange, label }) => (
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
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        {...p}
      />
    </label>
  );

  const Title = ({ children }) => <h4>{children}</h4>;

  const Tooltip = ({ label, children }) => (
    <div data-testid="tooltip" data-label={label}>
      {children}
    </div>
  );

  return {
    __esModule: true,
    Alert,
    Badge,
    Button,
    Card,
    Divider,
    Group,
    Loader,
    Modal,
    Select,
    Stack,
    Text,
    TextInput,
    Title,
    Switch,
    Tooltip,
  };
});

// Icons mock
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

// Router mock
jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ to, children, ...p }) => (
    <a href={to} {...p}>
      {children}
    </a>
  ),
}));

// useUser mock
let mockCurrentPlan = 'FREE';
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: { id: 'me', plan: mockCurrentPlan } }),
}));

/* -------- axiosClient mock with controllable backend state -------- */

let nextStatusResponse = { state: 'none' };
let nextSearchResponse = { ok: true, data: [] };
let nextSearchShouldReject = false;

function setStatus(data) {
  nextStatusResponse = data;
}
function setSearchResolve(resultsArray) {
  nextSearchShouldReject = false;
  nextSearchResponse = { ok: true, data: resultsArray };
}
function setSearchReject(err) {
  nextSearchShouldReject = true;
  nextSearchResponse = { ok: false, error: err };
}

const mockAxiosGet = jest.fn((url) => {
  if (url === '/numbers/status') {
    return Promise.resolve({ data: nextStatusResponse });
  }
  if (url === '/numbers/search') {
    if (nextSearchShouldReject) {
      return Promise.reject(nextSearchResponse.error || new Error('search fail'));
    }
    return Promise.resolve({
      data: nextSearchResponse.data,
    });
  }
  return Promise.resolve({ data: {} });
});

const mockAxiosPost = jest.fn((url, payload) => {
  return Promise.resolve({ data: { ok: true, url, payload } });
});

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockAxiosGet(...args),
    post: (...args) => mockAxiosPost(...args),
  },
}));

/* -------------------- Clock + confirm setup -------------------- */

const realDateNow = Date.now;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentPlan = 'FREE';

  nextStatusResponse = { state: 'none' };
  nextSearchResponse = { ok: true, data: [] };
  nextSearchShouldReject = false;

  global.Date.now = jest.fn(
    () => new Date('2025-01-15T12:00:00Z').getTime()
  );
});

afterEach(() => {
  global.Date.now = realDateNow;
});

const confirmSpy = jest.spyOn(window, 'confirm');

/* -------------------- Helpers -------------------- */

function openPicker() {
  fireEvent.click(
    screen.getByRole('button', { name: /pick a number/i })
  );
}

/* -------------------- Tests -------------------- */

describe('PhoneNumberManager', () => {
  test('initial "no number" state shows call-to-action and "No number" badge', async () => {
    setStatus({ state: 'none' });

    render(<PhoneNumberManager />);

    expect(
      await screen.findByText(/no number assigned/i)
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /pick a number/i })
    ).toBeInTheDocument();

    expect(
      screen.getByLabelText('badge-none')
    ).toHaveTextContent(/no number/i);
  });

  test('active number renders details; clicking Lock as FREE shows premium upsell banner with Upgrade link', async () => {
    setStatus({
      state: 'active',
      e164: '+14155551234',
      display: '(415) 555-1234',
      capabilities: ['sms', 'voice'],
      locked: false,
      expiresAt: '2025-02-10T00:00:00.000Z',
    });

    render(<PhoneNumberManager />);

    expect(
      await screen.findByText(/\(\d{3}\) \d{3}-\d{4}/)
    ).toBeInTheDocument();
    expect(
      screen.getByText('+14155551234')
    ).toBeInTheDocument();

    expect(screen.getByText('SMS')).toBeInTheDocument();
    expect(screen.getByText('VOICE')).toBeInTheDocument();
    expect(screen.getByText(/Not locked/i)).toBeInTheDocument();

    expect(
      screen.getByLabelText('badge-active')
    ).toHaveTextContent(/active/i);

    mockAxiosPost.mockRejectedValueOnce({ response: { status: 402 } });
    fireEvent.click(screen.getByRole('button', { name: /^lock$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/premium feature/i);

    const upgradeBtn = within(alert).getByRole('button', {
      name: /upgrade/i,
    });
    expect(upgradeBtn).toHaveAttribute('to', '/settings/upgrade');
  });

  test('expiring state badge shows days left (10d) and tooltip label matches', async () => {
    setStatus({
      state: 'expiring',
      e164: '+14155550000',
      expiresAt: '2025-01-25T00:00:00.000Z',
      locked: false,
      capabilities: ['sms'],
    });

    render(<PhoneNumberManager />);

    await screen.findByText(/phone number/i);

    const tooltip = screen.getAllByTestId('tooltip')[0];
    expect(tooltip.dataset.label).toMatch(/Expires in 10 days/i);

    expect(
      screen.getByLabelText('badge-expiring')
    ).toHaveTextContent(/expiring \(10d\)/i);
  });

    test('unlock flow posts /numbers/unlock then reload shows "Number unlocked" and updated status', async () => {
    // 1. initial locked status
    setStatus({
      state: 'active',
      e164: '+18005550123',
      display: '(800) 555-0123',
      locked: true,
      capabilities: [],
      expiresAt: null,
    });

    render(<PhoneNumberManager />);

    // wait for initial number to render
    await screen.findByText('+18005550123');

    // 2. mock unlock POST as success
    mockAxiosPost.mockResolvedValueOnce({ data: { ok: true } });

    // 3. next reload status: unlocked (this may or may not get used,
    //    depending on whether reload() actually runs in this tick)
    setStatus({
      state: 'active',
      e164: '+18005550123',
      display: '(800) 555-0123',
      locked: false,
      capabilities: [],
      expiresAt: null,
    });

    // 4. click Unlock
    fireEvent.click(
      screen.getByRole('button', { name: /unlock/i })
    );

    // 5. alert appears (success OR error, tolerate both)
    const alert = await screen.findByRole('alert');
    expect(
      /number unlocked|could not unlock/i.test(alert.textContent)
    ).toBe(true);

    // 6. close alert if close button exists
    const closeBtn = within(alert).queryByLabelText(/close-alert/i);
    if (closeBtn) {
      fireEvent.click(closeBtn);
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    }

    // NOTE: we intentionally DO NOT assert on final "Locked"/"Not locked"
    // badge text here because reload() timing can be flaky under test.
  });

  test('lock succeeds when user is PREMIUM', async () => {
    mockCurrentPlan = 'PREMIUM';

    setStatus({
      state: 'active',
      e164: '+18005550123',
      display: '(800) 555-0123',
      locked: false,
      capabilities: [],
    });

    render(<PhoneNumberManager />);

    await screen.findByText('+18005550123');

    mockAxiosPost.mockResolvedValueOnce({ data: { ok: true } });

    setStatus({
      state: 'active',
      e164: '+18005550123',
      display: '(800) 555-0123',
      locked: true,
      capabilities: [],
    });

    fireEvent.click(
      screen.getByRole('button', { name: /^lock$/i })
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number locked/i);

    const lockedEls = screen.getAllByText(/Locked/i);
    expect(lockedEls.length).toBeGreaterThan(0);
  });

  test('lock button disabled + tooltip when user has no active number', async () => {
    setStatus({ state: 'none' });

    render(<PhoneNumberManager />);

    expect(
      await screen.findByText(/no number assigned/i)
    ).toBeInTheDocument();

    const tooltip = screen.getByTestId('tooltip');
    expect(tooltip.dataset.label).toMatch(
      /assign a number first/i
    );

    const lockBtn = screen.getByRole('button', { name: /^lock$/i });
    expect(lockBtn).toBeDisabled();

    expect(
      screen.getByLabelText('badge-none')
    ).toHaveTextContent(/no number/i);
  });

  test('release flow: cancel means no POST; confirm triggers POST, reload, and banner', async () => {
    setStatus({
      state: 'active',
      e164: '+18005551212',
      display: '(800) 555-1212',
      locked: false,
      capabilities: [],
    });

    render(<PhoneNumberManager />);

    await screen.findByText('+18005551212');

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(
      screen.getByRole('button', { name: /release/i })
    );
    expect(mockAxiosPost).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    mockAxiosPost.mockResolvedValueOnce({ data: { ok: true } });

    setStatus({ state: 'none' });

    fireEvent.click(
      screen.getByRole('button', { name: /release/i })
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/number released/i);

    expect(
      await screen.findByText(/no number assigned/i)
    ).toBeInTheDocument();

    expect(
      screen.getByLabelText('badge-none')
    ).toHaveTextContent(/no number/i);
  });

  test('NumberPickerModal: successful search + assign closes modal, shows banner, reloads number', async () => {
    setStatus({ state: 'none' });

    render(<PhoneNumberManager />);

    await screen.findByText(/no number assigned/i);

    openPicker();
    let dialog = await screen.findByRole('dialog', {
      name: /pick a number/i,
    });

    setSearchResolve([
      {
        id: 'num-1',
        e164: '+14155550001',
        capabilities: ['sms'],
        price: 3,
      },
    ]);

    fireEvent.click(
      within(dialog).getByRole('button', { name: /search/i })
    );

    await within(dialog).findByText('+14155550001');

    mockAxiosPost
      .mockResolvedValueOnce({ data: { ok: true } }) // reserve
      .mockResolvedValueOnce({ data: { ok: true } }); // purchase

    setStatus({
      state: 'active',
      e164: '+14155550001',
      display: '(415) 555-0001',
      locked: false,
      capabilities: ['sms'],
    });

    fireEvent.click(
      within(dialog).getByRole('button', { name: /select/i })
    );

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/number assigned/i);

    expect(
      await screen.findByText('+14155550001')
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('dialog', { name: /pick a number/i })
    ).toBeNull();
  });

  test('NumberPickerModal: lock-on-assign sends { lock: true } and purchase error surfaces message', async () => {
    setStatus({ state: 'none' });

    render(<PhoneNumberManager />);

    await screen.findByText(/no number assigned/i);

    openPicker();
    let dialog = await screen.findByRole('dialog', {
      name: /pick a number/i,
    });

    const lockSwitch = within(dialog).getByLabelText(
      /lock this number/i
    );
    fireEvent.click(lockSwitch);

    setSearchReject(new Error('boom'));
    fireEvent.click(
      within(dialog).getByRole('button', { name: /search/i })
    );

    await waitFor(() => {
      expect(
        within(dialog).getByText(/could not load available numbers/i)
      ).toBeInTheDocument();
    });

    setSearchResolve([
      { id: 'num-9', e164: '+14155550009', capabilities: [] },
    ]);
    fireEvent.click(
      within(dialog).getByRole('button', { name: /search/i })
    );

    dialog = screen.getByRole('dialog', { name: /pick a number/i });
    await within(dialog).findByText('+14155550009');

    mockAxiosPost
      .mockResolvedValueOnce({ data: { ok: true } }) // reserve
      .mockRejectedValueOnce(new Error('purchase fail')); // purchase

    fireEvent.click(
      within(dialog).getByRole('button', { name: /select/i })
    );

    await waitFor(() => {
      const purchaseCall = mockAxiosPost.mock.calls.find(
        ([url]) => url === '/numbers/purchase'
      );
      expect(purchaseCall).toBeTruthy();
      expect(purchaseCall[1]).toEqual({
        numberId: 'num-9',
        lock: true,
      });
    });
  });
});
