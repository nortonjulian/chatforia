import { render, screen, fireEvent } from '@testing-library/react';
import MessageBubble from '@/components/MessageBubble';

// -------- Mocks --------

// Mantine stand-ins that expose useful props for assertions
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Group = ({ children, justify, ...p }) => (
    <div data-testid="group" data-justify={justify} {...p}>{children}</div>
  );

  // Render the text with role + expose Mantine color/bg props so we can assert
  const Text = ({ children, c, bg, ...p }) => (
    <p data-testid="text" data-c={c} data-bg={bg} role={p.role} aria-label={p['aria-label']}>
      {children}
    </p>
  );

  const ActionIcon = ({ children, onClick, 'aria-label': aria, title }) => (
    <button type="button" aria-label={aria} title={title} onClick={onClick}>
      {children}
    </button>
  );

  // Tooltip: just render children and expose label for assertion
  const Tooltip = ({ label, children }) => (
    <div data-testid="tooltip" data-label={label}>{children}</div>
  );

  return { Tooltip, Group, Text, ActionIcon };
});

// Icon (not relevant to behavior)
jest.mock('lucide-react', () => ({ RotateCw: (p) => <span data-testid="icon-rotate" {...p} /> }));

// dayjs -> deterministic formatting
const dayjsMock = (input) => ({
  format: (fmt) => `FMT(${input})`,
});
jest.mock('dayjs', () => dayjsMock);

// -------- Helpers --------
const baseMsg = {
  content: 'Hello there',
  createdAt: '2024-08-15T12:34:56.000Z',
  mine: false,
  failed: false,
};

describe('MessageBubble', () => {
  test('renders message content with tooltip label and aria-label timestamp', () => {
    render(<MessageBubble msg={baseMsg} />);

    // Tooltip shows formatted ts
    expect(screen.getByTestId('tooltip').dataset.label).toBe('FMT(2024-08-15T12:34:56.000Z)');

    // Text content + aria-label includes the same formatted ts
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    const text = screen.getByTestId('text');
    expect(text).toHaveAttribute('aria-label', 'Message sent FMT(2024-08-15T12:34:56.000Z)');
  });

  test('non-mine message aligns left and uses black text on gray bg', () => {
    render(<MessageBubble msg={{ ...baseMsg, mine: false }} />);

    const group = screen.getByTestId('group');
    expect(group.dataset.justify).toBe('flex-start');

    const text = screen.getByTestId('text');
    expect(text.dataset.c).toBe('black');
    expect(text.dataset.bg).toBe('gray.1');
  });

  test('mine message aligns right and uses white text on orbitBlue bg', () => {
    render(<MessageBubble msg={{ ...baseMsg, mine: true }} />);

    const group = screen.getByTestId('group');
    expect(group.dataset.justify).toBe('flex-end');

    const text = screen.getByTestId('text');
    expect(text.dataset.c).toBe('white');
    expect(text.dataset.bg).toBe('orbitBlue.6');
  });

  test('shows retry button only when failed, and calls onRetry with msg', () => {
    const onRetry = jest.fn();
    const failedMsg = { ...baseMsg, failed: true };

    // Failed -> button present and clickable
    render(<MessageBubble msg={failedMsg} onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: /retry sending message/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledWith(failedMsg);

    // Not failed -> no button
    render(<MessageBubble msg={{ ...baseMsg, failed: false }} onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: /retry sending message/i })).not.toBeInTheDocument();
  });
});
