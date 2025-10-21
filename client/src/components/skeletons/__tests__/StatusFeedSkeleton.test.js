import { render, screen } from '@testing-library/react';

// Mock Mantine primitives for prop inspection
jest.mock('@mantine/core', () => ({
  __esModule: true,
  SimpleGrid: ({ children, cols = {}, p, spacing }) => (
    <div
      data-testid="grid"
      data-cols-base={String(cols.base)}
      data-cols-sm={String(cols.sm)}
      data-cols-md={String(cols.md)}
      data-p={p}
      data-spacing={spacing}
    >
      {children}
    </div>
  ),
  Card: ({ children, withBorder, radius, p }) => (
    <div
      data-testid="card"
      data-with-border={String(!!withBorder)}
      data-radius={String(radius)}
      data-p={String(p)}
    >
      {children}
    </div>
  ),
  Skeleton: ({ height, radius, mt, width }) => (
    <div
      data-testid="skeleton"
      data-height={String(height)}
      data-radius={radius ? String(radius) : ''}
      data-mt={mt ? String(mt) : ''}
      data-width={width ? String(width) : ''}
    />
  ),
}));

// ✅ Correct relative path from __tests__ → skeletons
import StatusFeedSkeleton from '../StatusFeedSkeleton.jsx'; // change to .js if the file is .js

describe('StatusFeedSkeleton', () => {
  it('renders a SimpleGrid with the expected responsive cols, padding, and spacing', () => {
    render(<StatusFeedSkeleton />);
    const grid = screen.getByTestId('grid');
    expect(grid).toHaveAttribute('data-cols-base', '2');
    expect(grid).toHaveAttribute('data-cols-sm', '3');
    expect(grid).toHaveAttribute('data-cols-md', '4');
    expect(grid).toHaveAttribute('data-p', 'md');
    expect(grid).toHaveAttribute('data-spacing', 'md');
  });

  it('renders exactly 8 cards with proper Card props', () => {
    render(<StatusFeedSkeleton />);
    const cards = screen.getAllByTestId('card');
    expect(cards).toHaveLength(8);
    cards.forEach((card) => {
      expect(card).toHaveAttribute('data-with-border', 'true');
      expect(card).toHaveAttribute('data-radius', 'lg');
      expect(card).toHaveAttribute('data-p', 'md');
    });
  });

  it('renders two skeletons per card with correct sizes and spacing', () => {
    render(<StatusFeedSkeleton />);
    const skels = screen.getAllByTestId('skeleton');
    expect(skels).toHaveLength(16); // 2 per card * 8 cards

    for (let i = 0; i < 8; i++) {
      const primary = skels[2 * i];       // big thumbnail
      const caption = skels[2 * i + 1];   // small line

      // Primary skeleton
      expect(primary).toHaveAttribute('data-height', '120');
      expect(primary).toHaveAttribute('data-radius', 'md');
      expect(primary).toHaveAttribute('data-mt', '');

      // Caption skeleton
      expect(caption).toHaveAttribute('data-height', '14');
      expect(caption).toHaveAttribute('data-radius', '');
      expect(caption).toHaveAttribute('data-mt', 'sm');
      expect(caption).toHaveAttribute('data-width', '60%');
    }
  });
});
