import { render, screen } from '@testing-library/react';

// Mock Mantine so we can easily inspect props without relying on DOM structure
jest.mock('@mantine/core', () => ({
  __esModule: true,
  Stack: ({ children, ...props }) => (
    <div data-testid="stack" data-gap={props.gap} data-p={props.p}>
      {children}
    </div>
  ),
  Skeleton: ({ height, radius, ...props }) => (
    <div
      data-testid="skeleton"
      data-height={String(height)}
      data-radius={String(radius)}
      {...props}
    />
  ),
}));

// Adjust the import path to where the component lives
import ChatListSkeleton from './ChatListSketelon';

describe('ChatListSkeleton', () => {
  it('renders a Stack with the expected spacing props', () => {
    render(<ChatListSkeleton />);
    const stack = screen.getByTestId('stack');
    expect(stack).toHaveAttribute('data-gap', 'sm');
    expect(stack).toHaveAttribute('data-p', 'sm');
  });

  it('renders exactly 8 Skeleton placeholders with correct props', () => {
    render(<ChatListSkeleton />);
    const items = screen.getAllByTestId('skeleton');
    expect(items).toHaveLength(8);
    for (const el of items) {
      expect(el).toHaveAttribute('data-height', '48');
      expect(el).toHaveAttribute('data-radius', 'md');
    }
  });
});
