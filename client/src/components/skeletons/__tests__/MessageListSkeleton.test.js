import { render, screen } from '@testing-library/react';

// Mock Mantine primitives for prop inspection
jest.mock('@mantine/core', () => ({
  __esModule: true,
  Stack: ({ children, gap, p }) => (
    <div data-testid="stack" data-gap={gap} data-p={p}>
      {children}
    </div>
  ),
  Group: ({ children, justify }) => (
    <div data-testid="group" data-justify={justify}>
      {children}
    </div>
  ),
  Skeleton: ({ height, width, radius, ...rest }) => (
    <div
      data-testid="skeleton"
      data-height={String(height)}
      data-width={String(width)}
      data-radius={String(radius)}
      {...rest}
    />
  ),
}));

// Adjust the path if needed
import MessageListSkeleton from './MessageListSkeleton';

describe('MessageListSkeleton', () => {
  it('renders a Stack with the expected spacing props', () => {
    render(<MessageListSkeleton />);
    const stack = screen.getByTestId('stack');
    expect(stack).toHaveAttribute('data-gap', 'md');
    expect(stack).toHaveAttribute('data-p', 'md');
  });

  it('renders exactly 10 message rows (Groups)', () => {
    render(<MessageListSkeleton />);
    const groups = screen.getAllByTestId('group');
    expect(groups).toHaveLength(10);
  });

  it('alternates alignment and sets correct Skeleton sizes', () => {
    render(<MessageListSkeleton />);
    const groups = screen.getAllByTestId('group');
    const skels = screen.getAllByTestId('skeleton');

    expect(skels).toHaveLength(10);

    groups.forEach((group, i) => {
      const expectedJustify = i % 2 ? 'flex-end' : 'flex-start';
      const expectedWidth = i % 2 ? '220' : '280';

      expect(group).toHaveAttribute('data-justify', expectedJustify);
      expect(skels[i]).toHaveAttribute('data-height', '18');
      expect(skels[i]).toHaveAttribute('data-width', expectedWidth);
      expect(skels[i]).toHaveAttribute('data-radius', 'lg');
    });
  });
});
