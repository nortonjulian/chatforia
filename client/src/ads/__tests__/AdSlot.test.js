import React from 'react';
import {
  render,
  screen,
} from '@testing-library/react';

import AdSlot from '../AdSlot.jsx';

let mockCanShow = false;

const mockMarkShown = jest.fn();

jest.mock('@/ads/AdProvider', () => ({
  useAds: () => ({
    canShow: () => mockCanShow,
    markShown: mockMarkShown,
    provider: 'house',
  }),
}));

jest.mock('@/ads/HouseAdSlot', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="house-ad">
      House advertisement
    </div>
  ),
}));

jest.mock('@/ads/placements', () => ({
  getPlacementConfig: () => ({
    cap: {
      coolMs: 0,
    },
  }),
}));

describe('AdSlot hook ordering', () => {
  beforeEach(() => {
    mockCanShow = false;
    mockMarkShown.mockClear();
  });

  test(
    'can transition between hidden and visible without changing hook order',
    () => {
      const { container, rerender } = render(
        <AdSlot
          placement="search_results_footer"
          lazy={false}
        />
      );

      expect(container.firstChild).toBeNull();

      mockCanShow = true;

      rerender(
        <AdSlot
          placement="search_results_footer"
          lazy={false}
        />
      );

      expect(
        screen.getByTestId('house-ad')
      ).toBeInTheDocument();

      mockCanShow = false;

      rerender(
        <AdSlot
          placement="search_results_footer"
          lazy={false}
        />
      );

      expect(container.firstChild).toBeNull();
    }
  );
});
