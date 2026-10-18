import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupReadReceipt from '@/components/chat/GroupReadReceipt';

jest.mock('@mantine/core', () => ({
  Text: ({ children }) => <div>{children}</div>,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, options) => options.defaultValue.replace(/{{(\w+)}}/g, (_, token) => String(options[token])),
  }),
}));

const message = (readBy, extra = {}) => ({ id: 42, sender: { id: 68 }, readBy, ...extra });
const julian = { id: 1, username: 'julian' };
const regina = { id: 65, username: 'regina' };

test('live reader changes update the count and expandable identities', () => {
  const { rerender } = render(<GroupReadReceipt message={message([julian])} />);
  fireEvent.click(screen.getByRole('button', { name: 'Read by julian' }));
  expect(screen.getByRole('list', { name: 'Readers' })).toHaveTextContent('julian');
  rerender(<GroupReadReceipt message={message([julian, regina, julian, { id: 68, username: 'papi' }])} />);
  expect(screen.getByRole('button', { name: 'Read by 2' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('list')).toHaveTextContent('regina');
  fireEvent.click(screen.getByRole('button'));
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

test('private reads and preference changes do not fabricate group receipts', () => {
  const { rerender } = render(<GroupReadReceipt message={message([], { readAt: '2026-10-18T01:00:00Z' })} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(<GroupReadReceipt message={message([julian], { showReadReceipts: true })} />);
  expect(screen.getByRole('button', { name: 'Read by julian' })).toBeInTheDocument();
  expect(screen.queryByText('regina')).not.toBeInTheDocument();
});

test('fresh mounting restores only the shared readers', () => {
  const { unmount } = render(<GroupReadReceipt message={message([julian, regina])} />);
  unmount();
  render(<GroupReadReceipt message={JSON.parse(JSON.stringify(message([julian, regina])))} />);
  fireEvent.click(screen.getByRole('button', { name: 'Read by 2' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});

test('deleted messages reveal no reader names', () => {
  const { rerender } = render(<GroupReadReceipt message={message([julian], { deletedForAll: true })} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(<GroupReadReceipt message={message([julian], { deletedAt: '2026-10-18' })} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('missing names use an ID and user content remains literal text', () => {
  const literal = '<img src=x onerror=alert(1)> {{count}} %s';
  render(<GroupReadReceipt message={message([{ id: 1 }, { id: 65, username: literal }])} />);
  fireEvent.click(screen.getByRole('button', { name: 'Read by 2' }));
  expect(screen.getByText('User 1')).toBeInTheDocument();
  expect(screen.getByText(literal)).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});
