import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

const mockGet = jest.fn();
jest.mock('../../api/axiosClient', () => ({
  __esModule: true, default: { get: (...args) => mockGet(...args) },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback, values = {}) => fallback.replace(/\{\{(\w+)\}\}/g,
      (_match, name) => values[name] ?? ''),
  }),
}));
jest.mock('@mantine/core', () => ({
  Button: ({ component: Component = 'button', children, onClick, loading, to }) => (
    <Component onClick={onClick} disabled={Component === 'button' ? loading : undefined} to={to}>
      {children}
    </Component>
  ),
  Group: ({ children }) => <div>{children}</div>,
  Paper: ({ children }) => <section>{children}</section>,
  Stack: ({ children }) => <div>{children}</div>,
  Text: ({ children }) => <p>{children}</p>,
  Title: ({ children }) => <h3>{children}</h3>,
}));
import CallingAllowance from '../CallingAllowance';

function snapshot(remaining = 1200) {
  return { data: {
    resetAt: '2026-11-01T00:00:00.000Z',
    usage: { hostedParticipantSeconds: { used: 1800 - remaining, limit: 1800, remaining } },
  } };
}
function show() {
  return render(<MemoryRouter><CallingAllowance /></MemoryRouter>);
}

beforeEach(() => mockGet.mockReset());

test('shows server allowance, two-person equivalent, UTC reset and counting explanation', async () => {
  mockGet.mockResolvedValue(snapshot());
  show();
  expect(await screen.findByText('20 of 30 participant-minutes remaining')).toBeInTheDocument();
  expect(screen.getByText('About 10 minutes of two-person calling remaining.')).toBeInTheDocument();
  expect(screen.getByText(/Resets .*2026 at 00:00 UTC/)).toBeInTheDocument();
  expect(screen.getByText(/The person who starts the call covers everyone/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View plan options' })).toHaveAttribute('href', '/upgrade');
  expect(mockGet).toHaveBeenCalledWith('/premium/entitlements');
});

test('refresh reads saved usage again and shows exhausted state', async () => {
  mockGet.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot(0));
  show();
  await screen.findByText('20 of 30 participant-minutes remaining');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }));
  expect(await screen.findByText('0 of 30 participant-minutes remaining')).toBeInTheDocument();
  expect(screen.getByText('Your monthly app-calling allowance has been used up.')).toBeInTheDocument();
  expect(mockGet).toHaveBeenCalledTimes(2);
});

test('failed usage never invents a zero allowance and can retry', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot());
  show();
  await screen.findByText('Calling usage is unavailable. Try again.');
  expect(screen.queryByText(/participant-minutes remaining/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }));
  expect(await screen.findByText('20 of 30 participant-minutes remaining')).toBeInTheDocument();
});

test('unmount discards a late usage response', async () => {
  let resolve;
  mockGet.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = show();
  view.unmount();
  resolve(snapshot());
  await Promise.resolve();
  expect(screen.queryByText(/participant-minutes remaining/)).not.toBeInTheDocument();
});

test('malformed usage shows an error rather than claiming allowance is available', async () => {
  mockGet.mockResolvedValue({ data: { usage: {} } });
  show();
  expect(await screen.findByText('Calling usage is unavailable. Try again.')).toBeInTheDocument();
});
