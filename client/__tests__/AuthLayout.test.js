import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthLayout from '@/components/AuthLayout';

// ---- Mocks ----

// Minimal Mantine mocks (pass-through with a few conveniences)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Noop = ({ children, ...p }) => <div {...p}>{children}</div>;
  const GridCol = ({ children, ...p }) => <div data-mock="Grid.Col" {...p}>{children}</div>;
  const Grid = Object.assign(
    ({ children, ...p }) => <div data-mock="Grid" {...p}>{children}</div>,
    { Col: GridCol }
  );

  const ListItem = ({ children, ...p }) => <li {...p}>{children}</li>;
  const List = Object.assign(({ children, ...p }) => <ul {...p}>{children}</ul>, { Item: ListItem });

  const Anchor = ({ to, href, children, ...rest }) => (
    <a href={href || to} {...rest}>{children}</a>
  );

  const Button = ({ to, href, children, ...rest }) => (
    <a href={href || to} role="button" {...rest}>{children}</a>
  );

  const MantineImage = ({ src, alt, onError, ...rest }) => (
    <img src={src} alt={alt} onError={onError} {...rest} />
  );

  return {
    Container: Noop,
    Grid,
    Stack: Noop,
    Title: ({ children, ...p }) => <h1 {...p}>{children}</h1>,
    Text: ({ children, ...p }) => <p {...p}>{children}</p>,
    Image: MantineImage,
    ThemeIcon: Noop,
    List,
    Anchor,
    Group: Noop,
    Button,
    Paper: Noop,
    Divider: ({ label, ...p }) => <div {...p}>{label}</div>,
  };
});

// Icons -> simple spans
jest.mock('lucide-react', () => {
  const Icon = (name) => (props) => <span data-icon={name} {...props} />;
  return {
    Lock: Icon('Lock'),
    Globe: Icon('Globe'),
    MessageCircle: Icon('MessageCircle'),
    ShieldCheck: Icon('ShieldCheck'),
  };
});

// Local components
jest.mock('@/components/LogoGlyph', () => ({
  __esModule: true,
  default: ({ size }) => <div data-testid="logo-glyph" data-size={String(size)} />,
}));

// IMPORTANT: name starts with "mock" so it can be referenced in the mock factory
const mockSupport = jest.fn((props) => (
  <div data-testid="support-widget" data-props={JSON.stringify(props)} />
));
jest.mock('@/components/support/SupportWidget.jsx', () => ({
  __esModule: true,
  default: (props) => mockSupport(props),
}));

jest.mock('@/components/footer/Footer.jsx', () => ({
  __esModule: true,
  default: () => <footer data-testid="footer" />,
}));

jest.mock('@/ads/HouseAdSlot', () => ({
  __esModule: true,
  default: (props) => <div data-testid="house-ad-slot" data-props={JSON.stringify(props)} />,
}));

// ---- Helpers ----
const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route index element={<div data-testid="outlet">Index Outlet</div>} />
          <Route path="/login" element={<div data-testid="outlet">Login Outlet</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

// ---- Tests ----
describe('AuthLayout', () => {
  beforeEach(() => {
    mockSupport.mockClear();
  });

  test('renders layout at root (no breadcrumb) and shows outlet, app card, footer, support widget', () => {
    renderAt('/');

    // Outlet rendered
    expect(screen.getByTestId('outlet')).toHaveTextContent('Index Outlet');

    // No breadcrumb at root
    expect(screen.queryByText('← Home')).not.toBeInTheDocument();

    // “Create free account” (Button mocked as <a role="button"> with href)
    const createAccount = screen.getByRole('button', { name: /create free account/i });
    expect(createAccount).toHaveAttribute('href', '/register');

    // Status + Upgrade links
    expect(screen.getByRole('link', { name: /status/i })).toHaveAttribute('href', '/status');
    expect(screen.getByRole('link', { name: /upgrade/i })).toHaveAttribute(
      'href',
      '/settings/upgrade'
    );

    // App Store / Google Play links present
    expect(screen.getByRole('link', { name: /download on the app store/i })).toHaveAttribute(
      'href',
      'https://go.chatforia.com/ios'
    );
    expect(screen.getByRole('link', { name: /get it on google play/i })).toHaveAttribute(
      'href',
      'https://go.chatforia.com/android'
    );

    // Support widget & props
    const support = screen.getByTestId('support-widget');
    const supportProps = JSON.parse(support.getAttribute('data-props'));
    expect(supportProps.excludeRoutes).toEqual(['/login', '/reset-password']);

    // Footer present
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });

  test('shows breadcrumb on non-root routes and maps Link "to" -> anchor href', () => {
    renderAt('/login');

    // Outlet for /login
    expect(screen.getByTestId('outlet')).toHaveTextContent('Login Outlet');

    // Breadcrumb present and links to "/"
    const breadcrumbLink = screen.getByText('← Home').closest('a');
    expect(breadcrumbLink).toHaveAttribute('href', '/');
  });

  test('QR image falls back to generated URL on error', () => {
    renderAt('/');

    const qr = screen.getByAltText(/scan to get chatforia/i);
    // Trigger onError
    fireEvent.error(qr);

    // JSDOM turns src into absolute URL, so just check the important pieces
    expect(qr.getAttribute('src')).toContain('api.qrserver.com/v1/create-qr-code/');
    expect(qr.getAttribute('src')).toContain(
      encodeURIComponent('https://go.chatforia.com/app')
    );
  });
});
