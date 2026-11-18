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

import PlanUsage from '../PlanUsage';
function response() {
  const usage = Object.fromEntries(['riaActions','translationChars','smsMessages','pstnSeconds','forwardingSeconds','voiceNoteTranscriptionSeconds','voicemailTranscriptionSeconds'].map(key => [key, { used: 10, limit: 100, remaining: 90 }]));
  usage.voiceNoteTranscriptionSeconds = { used: 90, limit: 7200, remaining: 7110 };
  return { data: { resetAt: '2026-12-01T00:00:00.000Z', usage } };
}
beforeEach(() => mockGet.mockReset());
test('shows authoritative balances, measured minutes and reset', async () => {
  mockGet.mockResolvedValue(response());
  render(<PlanUsage />);
  expect(await screen.findByText('Voice-note transcription minutes: 118.5 of 120 remaining')).toBeInTheDocument();
  expect(screen.getByText('Shared AI actions: 90 of 100 remaining')).toBeInTheDocument();
  expect(screen.getByText(/Resets .*2026 at 00:00 UTC/)).toBeInTheDocument();
});
test('retry clears previous balances and never renders unavailable as zero', async () => {
  mockGet.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response());
  render(<PlanUsage />);
  await screen.findByText('Shared AI actions: 90 of 100 remaining');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }));
  await screen.findByText('Usage is unavailable. Please retry.');
  expect(screen.queryByText('Shared AI actions: 90 of 100 remaining')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }));
  await screen.findByText('Shared AI actions: 90 of 100 remaining');
});
test('malformed server values are unavailable, never unlimited', async () => {
  const value=response(); value.data.usage.riaActions.limit=null;
  mockGet.mockResolvedValue(value);
  render(<PlanUsage />);
  await screen.findByText('Usage is unavailable. Please retry.');
});
