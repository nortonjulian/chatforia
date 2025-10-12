import { render, screen } from '@testing-library/react';

// ---- Mocks ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (testid) => ({ children, ...props }) => (
    <div data-testid={testid} {...props}>{children}</div>
  );

  const Button = ({ children, component, href, ...rest }) => (
    <button data-testid="button" data-component={component || ''} data-href={href || ''} {...rest}>
      {children}
    </button>
  );

  const Divider = ({ label, ...rest }) => (
    <div data-testid="divider" data-label={label || ''} {...rest} />
  );

  return {
    __esModule: true,
    Box: passthru('box'),
    Card: passthru('card'),
    Stack: passthru('stack'),
    Text: passthru('text'),
    Button,
    Divider,
  };
});

// ads provider hook
const useAdsMock = jest.fn();
jest.mock('@/ads/AdProvider', () => ({
  __esModule: true,
  useAds: () => useAdsMock(),
}));

// ad wrappers/slot
jest.mock('@/ads/AdWrappers', () => ({
  __esModule: true,
  CardAdWrap: ({ children, ...rest }) => (
    <div data-testid="card-ad-wrap" {...rest}>{children}</div>
  ),
}));
jest.mock('@/ads/HouseAdSlot', () => ({
  __esModule: true,
  default: ({ placement, variant }) => (
    <div data-testid="house-ad-slot" data-placement={placement} data-variant={variant} />
  ),
}));

// SUT
import HomeIndex from './HomeIndex';

describe('HomeIndex', () => {
  beforeEach(() => {
    useAdsMock.mockReset();
  });

  test('renders base UI with headline and CTA button', () => {
    useAdsMock.mockReturnValue({ isPremium: true });

    render(<HomeIndex />);

    expect(
      screen.getByText(/select a text or chatroom to begin chatting/i)
    ).toBeInTheDocument();

    const btn = screen.getByTestId('button');
    expect(btn).toHaveTextContent(/start your first chat/i);
    // Button is rendered with component="a" href="/random" in the component; our mock exposes it as data attrs
    expect(btn).toHaveAttribute('data-component', 'a');
    expect(btn).toHaveAttribute('data-href', '/random');

    // Premium: no sponsored divider or ads
    expect(screen.queryByTestId('divider')).toBeNull();
    expect(screen.queryByTestId('card-ad-wrap')).toBeNull();
    expect(screen.queryByTestId('house-ad-slot')).toBeNull();
  });

  test('non-premium shows Sponsored divider and house ad inside wrapper with correct props', () => {
    useAdsMock.mockReturnValue({ isPremium: false });

    render(<HomeIndex />);

    const divider = screen.getByTestId('divider');
    expect(divider).toHaveAttribute('data-label', 'Sponsored');

    const wrap = screen.getByTestId('card-ad-wrap');
    expect(wrap).toBeInTheDocument();

    const ad = screen.getByTestId('house-ad-slot');
    expect(ad).toHaveAttribute('data-placement', 'empty_state_promo');
    expect(ad).toHaveAttribute('data-variant', 'card');
  });
});
