import { render, screen, cleanup } from '@testing-library/react';
import BrandLockup from '@/components/BrandLockup';

// ---- Mock MutationObserver so we can assert observe/disconnect calls ----
let lastObserverInstance = null;

class MockMutationObserver {
  constructor(cb) {
    this.cb = cb;
    this.observe = jest.fn((target, options) => {
      this.target = target;
      this.options = options;
    });
    this.disconnect = jest.fn();
    lastObserverInstance = this;
  }
}

beforeAll(() => {
  // Provide a controlled default theme for tests
  document.documentElement.setAttribute('data-theme', 'light');
  global.MutationObserver = MockMutationObserver;
});

afterEach(() => {
  cleanup();
  lastObserverInstance = null;
});

describe('BrandLockup', () => {
  test('renders default logo, gradient wordmark and applies className', () => {
    render(<BrandLockup className="extra-class" />);

    const wrapper = document.querySelector('.brand-lockup.extra-class');
    expect(wrapper).toBeInTheDocument();

    const img = screen.getByAltText(/chatforia logo/i);
    expect(img).toHaveAttribute('src', '/brand/ppog.png');

    const wordmark = screen.getByText('Chatforia');
    expect(wordmark).toHaveClass('brand-lockup__name');
    // gradient is ON by default
    expect(wordmark).toHaveClass('text-blue-purple');
    expect(wordmark).toHaveClass('bp-wordmark');

    // MutationObserver attached to <html> for data-theme
    expect(lastObserverInstance).not.toBeNull();
    expect(lastObserverInstance.observe).toHaveBeenCalledTimes(1);
    expect(lastObserverInstance.target).toBe(document.documentElement);
    expect(lastObserverInstance.options).toMatchObject({
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  });

  test('sets CSS variable from logoSize prop', () => {
    render(<BrandLockup logoSize={80} />);
    const wrapper = document.querySelector('.brand-lockup');
    // style attribute contains the CSS variable
    expect(wrapper.getAttribute('style')).toContain('--logo-size: 80px');
  });

  test('disables gradient classes when gradientWordmark is false', () => {
    render(<BrandLockup gradientWordmark={false} />);
    const wordmark = screen.getByText('Chatforia');
    expect(wordmark).toHaveClass('brand-lockup__name');
    expect(wordmark).not.toHaveClass('text-blue-purple');
    expect(wordmark).not.toHaveClass('bp-wordmark');
  });

  test('renders a custom wordmark string', () => {
    render(<BrandLockup wordmark="Chatforia Beta" />);
    expect(screen.getByText('Chatforia Beta')).toBeInTheDocument();
  });

  test('disconnects MutationObserver on unmount', () => {
    const { unmount } = render(<BrandLockup />);
    // Make sure we captured an observer instance
    expect(lastObserverInstance).not.toBeNull();
    unmount();
    expect(lastObserverInstance.disconnect).toHaveBeenCalledTimes(1);
  });
});
