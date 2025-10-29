import React from 'react';

import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';

import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';
import { installThemeFaviconObserver } from '@/utils/themeFavicon';
installThemeFaviconObserver();

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import './styles/themes.css';

import './i18n';

import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';

import { AdProvider } from '@/ads/AdProvider';
import { SocketProvider } from './context/SocketContext';
import { UserProvider } from './context/UserContext';
import { CallProvider } from './context/CallContext';

import ErrorBoundary from './ErrorBoundary';
import App from './App.jsx';
import { chatforiaTheme } from './theme.js';
import axiosClient, { primeCsrf } from './api/axiosClient';

// a11y + perf helpers
import SkipToContent from './components/SkipToContent.jsx';
import A11yAnnouncer from './components/A11yAnnouncer.jsx';
import { initWebVitals } from './utils/perf/vitals.js';

// THEME MANAGER: single source of truth
import {
  applyTheme,
  getTheme,
  onThemeChange,
  setTheme,
  isDarkTheme,
} from './utils/themeManager';

// Apply stored/default theme on boot (defaults to "dawn" now)
applyTheme();

// Best-effort: if user is already authenticated, pull their server-stored theme
(async () => {
  try {
    await primeCsrf();
    const { data: me } = await axiosClient.get('/users/me');
    if (me?.theme && me.theme !== getTheme()) {
      setTheme(me.theme); // updates <html data-theme> and Mantine scheme via onThemeChange
    }
  } catch {
    // not logged in or endpoint unavailable — ignore
  }
})();

const isProd = import.meta.env.PROD;

/* ---------------- Sentry (prod only) ---------------- */
if (isProd && import.meta.env.VITE_SENTRY_DSN) {
  (async () => {
    const integrations = [Sentry.browserTracingIntegration()];

    if (import.meta.env.VITE_SENTRY_REPLAY === 'true') {
      try {
        const { replayIntegration } = await import('@sentry/replay');
        integrations.push(replayIntegration());
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[sentry] @sentry/replay not installed; continuing without it');
      }
    }

    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_COMMIT_SHA,
      integrations,
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0.15),
      // (only used if Replay is enabled)
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  })();
}

/* ---------------- Mantine theme ---------------- */
const theme = createTheme({
  ...chatforiaTheme,
  primaryShade: 5,
  components: {
    // keep all styles/variants from chatforiaTheme
    ...chatforiaTheme.components,

    TextInput: {
      ...chatforiaTheme.components?.TextInput,
      defaultProps: {
        ...(chatforiaTheme.components?.TextInput?.defaultProps || {}),
        size: 'md',
        variant: 'filled',
      },
    },

    PasswordInput: {
      ...chatforiaTheme.components?.PasswordInput,
      defaultProps: {
        ...(chatforiaTheme.components?.PasswordInput?.defaultProps || {}),
        size: 'md',
        variant: 'filled',
      },
    },

    Button: {
      ...chatforiaTheme.components?.Button,
      defaultProps: {
        ...(chatforiaTheme.components?.Button?.defaultProps || {}),
        radius: 'xl',
        size: 'md',
      },
    },
  },
});


/* ---------------- Root ---------------- */
function Root() {
  // Mantine wants 'light' | 'dark'; map custom themes with isDarkTheme
  const [scheme, setScheme] = React.useState(isDarkTheme(getTheme()) ? 'dark' : 'light');

  // Keep Mantine scheme in sync with our theme manager
  React.useEffect(() => {
    const unsub = onThemeChange((t) => setScheme(isDarkTheme(t) ? 'dark' : 'light'));
    return unsub;
  }, []);

  // start collecting Web Vitals (lazy-loaded)
  React.useEffect(() => {
    initWebVitals();
  }, []);

  return (
    <ErrorBoundary>
      <MantineProvider theme={theme} defaultColorScheme={scheme}>
        <Notifications position="top-right" limit={3} />

        {/* a11y helpers mounted once */}
        <SkipToContent targetId="main-content" />
        <A11yAnnouncer />

        {/* IMPORTANT: SocketProvider must wrap UserProvider */}
        <SocketProvider>
          <UserProvider>
            {/* AdProvider inside UserProvider so it can read plan and disable ads for Premium */}
            <AdProvider>
              <CallProvider>
                <BrowserRouter>
                  <App
                    themeScheme={scheme}
                    onToggleTheme={() => {
                      // Flip specifically between Dawn (light) <-> Midnight (flagship dark)
                      const next = scheme === 'light' ? 'midnight' : 'dawn';
                      setTheme(next);
                    }}
                  />
                </BrowserRouter>
              </CallProvider>
            </AdProvider>
          </UserProvider>
        </SocketProvider>
      </MantineProvider>
    </ErrorBoundary>
  );
}

/* ---------------- Mount ---------------- */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* ✅ Wrap the entire app with I18nextProvider so every child
        (Sidebar, header buttons, drawers, etc.) responds to language changes */}
    <I18nextProvider i18n={i18n}>
      <Root />
    </I18nextProvider>
  </React.StrictMode>
);
