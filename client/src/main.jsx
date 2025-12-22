import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';

import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import 'react-phone-number-input/style.css';
import './styles.css';
import './styles/themes.css';

import './i18n';

import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';

import { SocketProvider } from './context/SocketContext';
import { UserProvider } from './context/UserContext';

import ErrorBoundary from './ErrorBoundary';
import App from './App.jsx';
import { chatforiaTheme } from './theme.js';
import axiosClient, { primeCsrf } from './api/axiosClient';

// a11y + perf helpers
import A11yAnnouncer from './components/A11yAnnouncer.jsx';
import { initWebVitals } from './utils/perf/vitals.js';

// THEME MANAGER: single source of truth
import { applyTheme, getTheme, onThemeChange, setTheme, isDarkTheme } from './utils/themeManager';

import { installThemeFaviconObserver } from '@/utils/themeFavicon';

/* ---------------- Global hard-error logging ---------------- */
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.error || e.message, e);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason, e);
});

/* ---------------- Sentry (prod only) ---------------- */
const isProd = import.meta.env.PROD;

if (isProd && import.meta.env.VITE_SENTRY_DSN) {
  (async () => {
    try {
      const integrations = [Sentry.browserTracingIntegration()];

      if (import.meta.env.VITE_SENTRY_REPLAY === 'true') {
        try {
          const { replayIntegration } = await import('@sentry/replay');
          integrations.push(replayIntegration());
        } catch {
          console.warn('[sentry] @sentry/replay not installed; continuing without it');
        }
      }

      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_COMMIT_SHA,
        integrations,
        tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0.15),
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
      });
    } catch (err) {
      console.error('[sentry.init] failed', err);
    }
  })();
}

/* ---------------- Mantine theme ---------------- */
const theme = createTheme({
  ...chatforiaTheme,
  primaryShade: 5,
  components: {
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
  // Ensure theme is applied, but never let it kill mounting
  React.useEffect(() => {
    try {
      applyTheme();
    } catch (e) {
      console.error('[applyTheme] failed', e);
    }

    try {
      installThemeFaviconObserver();
    } catch (e) {
      console.error('[installThemeFaviconObserver] failed', e);
    }
  }, []);

  // Mantine wants 'light' | 'dark'
  const [scheme, setScheme] = React.useState(isDarkTheme(getTheme()) ? 'dark' : 'light');

  // Keep Mantine scheme in sync with our theme manager
  React.useEffect(() => {
    try {
      const unsub = onThemeChange((t) => setScheme(isDarkTheme(t) ? 'dark' : 'light'));
      return unsub;
    } catch (e) {
      console.error('[onThemeChange] failed', e);
      return undefined;
    }
  }, []);

  // start collecting Web Vitals (lazy-loaded)
  React.useEffect(() => {
    try {
      initWebVitals();
    } catch (e) {
      console.error('[initWebVitals] failed', e);
    }
  }, []);

  // Best-effort: pull server-stored theme (do NOT block mount)
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await primeCsrf();
        const { data: me } = await axiosClient.get('/users/me');
        if (!alive) return;
        if (me?.theme && me.theme !== getTheme()) setTheme(me.theme);
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[boot theme] skipped', e);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <ErrorBoundary>
      <MantineProvider theme={theme} defaultColorScheme={scheme} forceColorScheme={scheme}>
        {/* Global notifications host */}
        <Notifications position="top-right" limit={3} />

        {/* a11y helpers mounted once */}
        <A11yAnnouncer />

        {/* IMPORTANT: SocketProvider must wrap UserProvider */}
        <SocketProvider>
          <UserProvider>
            <BrowserRouter>
              <App
                themeScheme={scheme}
                onToggleTheme={() => {
                  const next = scheme === 'light' ? 'midnight' : 'dawn';
                  setTheme(next);
                }}
              />
            </BrowserRouter>
          </UserProvider>
        </SocketProvider>
      </MantineProvider>
    </ErrorBoundary>
  );
}

/* ---------------- Mount ---------------- */
const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('[main.jsx] #root element not found. Check index.html');
} else {
  console.log('[main.jsx] mounting app ✅');
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <Root />
      </I18nextProvider>
    </React.StrictMode>
  );
}
