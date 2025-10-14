import React from 'react';
import * as rtl from '@testing-library/react';

// ---------- Optional Router wrapper ----------
let MemoryRouter;
try {
  // Lazily require so tests that don't have react-router-dom don't fail
  ({ MemoryRouter } = require('react-router-dom'));
} catch {
  // Fallback: just render children
  MemoryRouter = ({ children }) => <>{children}</>;
}

// ---------- Optional Mantine provider ----------
let MantineProvider;
try {
  ({ MantineProvider } = require('@mantine/core'));
} catch {
  MantineProvider = ({ children }) => <>{children}</>;
}

// ---------- Optional User context (real or shim) ----------
let UserProvider;
let useUser;
try {
  // Preferred path
  // eslint-disable-next-line import/no-unresolved
  const ctx = require('src/context/UserContextInstance.jsx');
  UserProvider = ctx.UserProvider || ctx.default || (({ children }) => children);
  useUser = ctx.useUser || (() => ({ currentUser: null }));
} catch {
  try {
    // Fallback path
    // eslint-disable-next-line import/no-unresolved
    const ctx2 = require('src/context/UserContext.jsx');
    UserProvider = ctx2.UserProvider || ctx2.default || (({ children }) => children);
    useUser = ctx2.useUser || (() => ({ currentUser: null }));
  } catch {
    // Last-resort shim so tests still run even if app context isn't present
    const FallbackContext = React.createContext({ currentUser: null });
    UserProvider = ({ children, value }) => (
      <FallbackContext.Provider value={value || { currentUser: null }}>
        {children}
      </FallbackContext.Provider>
    );
    useUser = () => React.useContext(FallbackContext);
  }
}

// ---------- Public helpers ----------
export function renderWithRouter(ui, options) {
  const routerProps = options?.router || {};
  const userValue = options?.userValue; // pass { currentUser: ... } when needed

  return rtl.render(
    <MantineProvider>
      <UserProvider value={userValue}>
        <MemoryRouter {...routerProps}>{ui}</MemoryRouter>
      </UserProvider>
    </MantineProvider>,
    options
  );
}

export function renderWithProviders(ui, options) {
  const userValue = options?.userValue;

  return rtl.render(
    <MantineProvider>
      <UserProvider value={userValue}>{ui}</UserProvider>
    </MantineProvider>,
    options
  );
}

// Re-export RTL so tests can import fireEvent, screen, etc. from here if desired
export * from '@testing-library/react';
// And export the bare render in case some tests still want it
export const render = rtl.render;
// Also export the hook in case a test needs to read the context
export { useUser };
