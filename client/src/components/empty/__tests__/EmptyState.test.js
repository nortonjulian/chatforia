import { render, screen, fireEvent } from '@testing-library/react';
import EmptyState from '@/components/EmptyState';

// -------------------- Mocks --------------------

// Mantine primitives
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Center = ({ children, ...p }) => <div data-testid="center" {...p}>{children}</div>;
  const Stack = ({ children, ...p }) => <div data-testid="stack" {...p}>{children}</div>;
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;
  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );
  const Box = ({ children, ...p }) => <div {...p}>{children}</div>;
  return { Center, Stack, Text, Button, Box };
});

// Ads: component + wrappers + placements + provider
const houseAdMock = jest.fn((p) => <div data-testid={`house-ad-${p.placement}`} data-variant={p.variant} />);
jest.mock('@/ads/HouseAdSlot', () => ({ __esModule: true, default: (p) => houseAdMock(p) }));

const cardWrapMock = jest.fn(({ children }) => <div data-testid="card-wrap">{children}</div>);
jest.mock('@/ads/AdWrappers', () => ({ __esModule: true, CardAdWrap: (p) => cardWrapMock(p) }));

jest.mock('@/ads/placements', () => ({
  PLACEMENTS: { EMPTY_STATE_PROMO: 'EMPTY_STATE_PROMO' },
}));

// useAds hook
const canShowMock = jest.fn(() => true);
const markShownMock = jest.fn();
jest.mock('@/ads/AdProvider', () => ({
  useAds: () => ({ canShow: canShowMock, markShown: markShownMock }),
}));

// ADS_CONFIG (only used for logging; keep simple)
jest.mock('@/ads/config', () => ({ ADS_CONFIG: { house: { a: 1, b: 2 } } }));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  // Lock Date.now so we can assert persisted timestamp
  jest.spyOn(Date, 'now').mockReturnValue(1_000_000); // 1,000,000 ms
});

afterEach(() => {
  jest.restoreAllMocks();
});

// -------------------- Tests --------------------
describe('EmptyState', () => {
  test('renders title, optional subtitle, and CTA that triggers onCta', () => {
    const onCta = jest.fn();
    render(
      <EmptyState
        title="Nothing here yet"
        subtitle="Invite your friends"
        cta="Do the thing"
        onCta={onCta}
        isPremium={false}
      />
    );

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('Invite your friends')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /do the thing/i }));
    expect(onCta).toHaveBeenCalled();
  });

  test('non-premium + allowed by ads -> shows house promo and calls markShown with capKey', () => {
    canShowMock.mockReturnValueOnce(true);

    render(
      <EmptyState
        title="t"
        isPremium={false}
        enableHousePromo={true}
        capKey="app"
      />
    );

    // House ad visible inside CardAdWrap
    expect(screen.getByTestId('card-wrap')).toBeInTheDocument();
    const ad = screen.getByTestId('house-ad-EMPTY_STATE_PROMO');
    expect(ad).toBeInTheDocument();
    expect(ad.dataset.variant).toBe('card');

    // markShown called with placement and capKey
    expect(markShownMock).toHaveBeenCalledWith('EMPTY_STATE_PROMO', 'app');
  });

  test('premium users do not see promo even if ads allow it', () => {
    canShowMock.mockReturnValueOnce(true);

    render(
      <EmptyState
        title="t"
        isPremium={true}
        enableHousePromo={true}
        capKey="app"
      />
    );

    expect(screen.queryByTestId('house-ad-EMPTY_STATE_PROMO')).not.toBeInTheDocument();
    expect(markShownMock).not.toHaveBeenCalled();
  });

  test('enableHousePromo=false hides promo regardless of ads/premium', () => {
    canShowMock.mockReturnValueOnce(true);

    render(
      <EmptyState
        title="t"
        isPremium={false}
        enableHousePromo={false}
        capKey="x"
      />
    );

    expect(screen.queryByTestId('house-ad-EMPTY_STATE_PROMO')).not.toBeInTheDocument();
    expect(markShownMock).not.toHaveBeenCalled();
  });

  test('ads.canShow=false hides promo and does not call markShown', () => {
    canShowMock.mockReturnValueOnce(false);

    render(
      <EmptyState
        title="t"
        isPremium={false}
        enableHousePromo={true}
        capKey="cap-123"
      />
    );

    expect(screen.queryByTestId('house-ad-EMPTY_STATE_PROMO')).not.toBeInTheDocument();
    expect(markShownMock).not.toHaveBeenCalled();
  });

  test('dismiss button hides promo immediately and persists dismissal for 14 days', () => {
    canShowMock.mockReturnValueOnce(true);

    render(
      <EmptyState
        title="t"
        isPremium={false}
        enableHousePromo={true}
        capKey="app"
      />
    );

    // Promo visible
    expect(screen.getByTestId('house-ad-EMPTY_STATE_PROMO')).toBeInTheDocument();

    // Click "Hide for now"
    fireEvent.click(screen.getByRole('button', { name: /hide for now/i }));

    // Promo disappears
    expect(screen.queryByTestId('house-ad-EMPTY_STATE_PROMO')).not.toBeInTheDocument();

    // LocalStorage key written with (now + 14d)
    const key = 'dismiss:empty_state_promo';
    const stored = Number(localStorage.getItem(key));
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    expect(stored).toBe(1_000_000 + fourteenDaysMs);
  });

  test('capKey is passed to canShow/markShown', () => {
    canShowMock.mockReturnValueOnce(true);
    render(
      <EmptyState
        title="t"
        isPremium={false}
        enableHousePromo={true}
        capKey="my-cap"
      />
    );
    expect(canShowMock).toHaveBeenCalledWith('EMPTY_STATE_PROMO', 'my-cap');
    expect(markShownMock).toHaveBeenCalledWith('EMPTY_STATE_PROMO', 'my-cap');
  });
});
