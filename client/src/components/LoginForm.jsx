import { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { useNavigate, Link } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import {
  Paper,
  Title,
  Text,
  TextInput,
  PasswordInput,
  Button,
  Anchor,
  Alert,
  Stack,
  Group,
  Divider,
  Checkbox,
} from '@mantine/core';
import { IconBrandGoogle, IconBrandApple } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

/* ---------------- env + helpers ---------------- */

// Prefer an absolute API in prod; fall back to a same-origin dev proxy.
const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  '';

const oauthBase = (import.meta.env.VITE_OAUTH_BASE_PATH || '/auth').replace(/\/$/, '');
const webPrefix = import.meta.env.VITE_WEB_API_PREFIX || '';

function absoluteApi(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return apiBase ? `${apiBase}${clean}` : `${webPrefix}${clean}`;
}

// Read the CSRF token from cookie if present (double-submit pattern)
function readXsrfCookie(name = 'XSRF-TOKEN') {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

// Fetch CSRF token (supports both JSON {csrfToken} or cookie-only styles)
async function getCsrfToken() {
  try {
    const res = await fetch(absoluteApi('/auth/csrf'), { credentials: 'include' });
    try {
      const data = await res.json();
      if (data && typeof data.csrfToken === 'string' && data.csrfToken.length) {
        return data.csrfToken;
      }
    } catch {
      /* ignore JSON parse; fall back to cookie */
    }
  } catch {
    /* ignore; fall back to cookie */
  }
  return readXsrfCookie('XSRF-TOKEN');
}

// Begin an OAuth flow on the API, with a clean return to the app
function startOAuth(provider) {
  const next = `${window.location.origin}/auth/complete`;
  window.location.assign(
    absoluteApi(`${oauthBase}/${provider}?next=${encodeURIComponent(next)}`)
  );
}

/* ---------------- Component ---------------- */

const LOGIN_FLAG_KEY = 'chatforiaHasLoggedIn';

export default function LoginForm({ onLoginSuccess }) {
  const { t } = useTranslation();
  const { setCurrentUser } = useUser();
  const [identifier, setIdentifier] = useState(''); // username or email or phone
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // SSO availability (runtime)
  const [hasGoogle, setHasGoogle] = useState(true);
  const [hasApple, setHasApple] = useState(false);

  // UI state: has this device logged in before?
  const [hasBeenHere, setHasBeenHere] = useState(false);

  const navigate = useNavigate();

  // UI-only hinting; payload will include username for backend compatibility.
  // We intentionally keep this backend mapping but make the UI identifier flexible.
  const idField = (import.meta.env.VITE_AUTH_ID_FIELD || 'username').toLowerCase();
  const isEmailMode = idField === 'email';

  // Short label + placeholder pattern: short label ("Account"), placeholder gives examples.
  const idLabel = t('login.accountLabel', 'Account');
  const idPlaceholder = t(
    'login.identifierPh',
    'Email or username'
  );
  // Keep autocomplete set to 'username' to maximize browser compatibility.
  const idAutoComplete = 'username';

  const placeholderColor = 'color-mix(in oklab, var(--fg) 72%, transparent)';

  // Short visual labels for the SSO buttons (avoid truncation)
  const googleVisualLabel = t('login.googleShort', 'Google');
  const appleVisualLabel = t('login.appleShort', 'Apple');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(absoluteApi(`${oauthBase}/debug`), {
          credentials: 'include',
        });
        const j = await res.json();
        if (cancelled) return;
        setHasGoogle(!!j.hasGoogle);
        setHasApple(!!j.hasApple);
      } catch {
        // leave optimistic values in place
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Check localStorage to see if this device has logged in before
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const flag = window.localStorage.getItem(LOGIN_FLAG_KEY);
      setHasBeenHere(flag === 'true');
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const idValue = identifier.trim();
    const pwd = password.trim();
    if (!idValue || !pwd) {
      setError(t('login.error.missing', 'Please enter your credentials.'));
      setLoading(false);
      return;
    }

    // NOTE: backend expects `{ username, password }` — keep that but allow frontend to accept email/phone.
    const payload = { identifier: idValue, password: pwd };

    try {
      // --- CSRF bootstrap ---
      const csrfToken = await getCsrfToken();
      if (csrfToken) {
        // Server expects X-XSRF-TOKEN (matches axiosClient xsrfHeaderName)
        axiosClient.defaults.headers.common['X-XSRF-TOKEN'] = csrfToken;
      }

      const res = await axiosClient.post('/auth/login', payload);
      const user = res?.data?.user ?? res?.data;

      setCurrentUser(user);
      onLoginSuccess?.(user);

      // mark this device as having successfully logged in
      try {
        window.localStorage.setItem(LOGIN_FLAG_KEY, 'true');
        setHasBeenHere(true);
      } catch {
        // ignore storage errors
      }

      setIdentifier('');
      setPassword('');

      navigate('/');
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data || {};
      const apiMsg = data.message || data.error || data.details || '';
      const reason = data.reason || data.code;

      let msg = apiMsg || t('login.error.invalid', 'Invalid username or password');

      if (status === 400) {
        msg = apiMsg || t('login.error.missing', 'Please enter your credentials.');
      } else if (status === 401) {
        msg = apiMsg || t('login.error.invalid', 'Invalid username or password');
      } else if (status === 403) {
        msg = apiMsg || t('login.error.denied', 'Access denied.');
      } else if (status === 422) {
        msg =
          apiMsg ||
          t(
            'login.error.unprocessable',
            'Invalid request. Check your username/email and password.'
          );
      } else if (status === 402) {
        if (reason === 'DEVICE_LIMIT') {
          msg = t(
            'login.error.deviceLimit',
            'Device limit reached for the Free plan. Log out on another device or upgrade to Premium to link more devices.'
          );
        } else {
          msg =
            apiMsg ||
            t(
              'login.error.premiumRequired',
              'This action requires a Premium plan.'
            );
        }
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const titleText = hasBeenHere
    ? t('login.welcomeBack', 'Welcome back')
    : t('login.title', 'Continue to Chatforia');

  // Always keep the subtitle login-focused; signup lives in the hero
  const subtitleText = t(
    'login.subtitleReturning',
    'Log in to your Chatforia account'
  );

  return (
    <Paper
      withBorder
      shadow="md"
      radius="xl"
      p="lg"
      className="auth-login-card"
    >
      <Stack gap={4} mb="sm" align="center">
        <Title order={3} style={{ color: 'var(--fg)', letterSpacing: -0.2 }}>
          {titleText}
        </Title>
        <Text
          size="sm"
          style={{ color: 'var(--fg)', opacity: 0.8, textAlign: 'center' }}
        >
          {subtitleText}
        </Text>
      </Stack>

      <Group grow mb="xs" className="auth-sso-buttons">
        <Button
          className="oauth-button"
          variant="light"
          leftSection={<IconBrandGoogle size={18} />}
          onClick={() => startOAuth('google')}
          disabled={!hasGoogle}
          title={
            hasGoogle
              ? t('login.google', 'Continue with Google')
              : t('login.googleUnavailable', 'Google sign-in unavailable')
          }
          aria-label={t('login.google', 'Continue with Google')}
        >
          {googleVisualLabel}
        </Button>
        <Button
          className="oauth-button"
          variant="light"
          leftSection={<IconBrandApple size={18} />}
          onClick={() => startOAuth('apple')}
          disabled={!hasApple}
          title={
            hasApple
              ? t('login.apple', 'Continue with Apple')
              : t('login.appleUnavailable', 'Apple sign-in unavailable')
          }
          aria-label={t('login.apple', 'Continue with Apple')}
        >
          {appleVisualLabel}
        </Button>
      </Group>

      {!hasGoogle && !hasApple && (
        <Text size="sm" style={{ color: 'var(--fg)', opacity: 0.7 }} mb="xs">
          {t(
            'login.ssoUnavailable',
            'Single-sign-on is currently unavailable. Use username & password instead.'
          )}
        </Text>
      )}

      <Divider
        label={t('login.or', 'or')}
        my="sm"
        styles={{ label: { color: 'var(--fg)', opacity: 0.75 } }}
      />

      <form onSubmit={handleLogin} noValidate>
        <Stack gap="sm">
          <TextInput
            label={idLabel}
            placeholder={idPlaceholder}
            value={identifier}
            onChange={(e) => setIdentifier(e.currentTarget.value)}
            required
            autoComplete={idAutoComplete}
            labelProps={{ style: { color: 'var(--fg)' } }}
            styles={{
              input: {
                color: 'var(--fg)',
                '::placeholder': { color: placeholderColor },
              },
            }}
          />

          <PasswordInput
            label={t('login.passwordLabel', 'Password')}
            placeholder={t('login.passwordPh', 'Your password')}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
            autoComplete="current-password"
            labelProps={{ style: { color: 'var(--fg)' } }}
            styles={{
              input: {
                color: 'var(--fg)',
                '::placeholder': { color: placeholderColor },
              },
            }}
          />

          <Group justify="space-between" align="center" mt={2}>
            <Checkbox
              label={t('login.keepSignedIn', 'Keep me signed in')}
              checked={remember}
              onChange={(e) => setRemember(e.currentTarget.checked)}
              styles={{ label: { color: 'var(--fg)' } }}
            />
            <Anchor
              component={Link}
              to="/forgot-password"
              size="sm"
              style={{ color: 'var(--accent)' }}
            >
              {t('login.forgot', 'Forgot password?')}
            </Anchor>
          </Group>

          {error && (
            <Alert
              color="red"
              variant="light"
              role="alert"
              styles={{ message: { color: 'var(--fg)' } }}
            >
              {error}
            </Alert>
          )}

          <Button type="submit" loading={loading} fullWidth mt="sm">
            {loading
              ? t('login.loggingIn', 'Logging in…')
              : t('login.submit', 'Log In')}
          </Button>

          {/* Intentionally removed the "New here? Create an account" line.
              Signup is handled by the hero CTA; do not reintroduce a competing
              signup link inside the transactional login card. */}
        </Stack>
      </form>
    </Paper>
  );
}