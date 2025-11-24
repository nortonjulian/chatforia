import axios from 'axios';

/** -------- Env helpers -------- */
const isViteEnv =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env !== 'undefined';

const isNodeEnv =
  typeof process !== 'undefined' &&
  typeof process.env !== 'undefined';

const isBrowser =
  typeof window !== 'undefined';

const isDev =
  (isViteEnv && !!import.meta.env.DEV) ||
  (isNodeEnv && process.env.NODE_ENV === 'development');

/** -------- Base URL detection --------
 *
 * PRODUCTION:
 *   Set VITE_API_BASE_URL when building the client, e.g.:
 *     VITE_API_BASE_URL="https://api.chatforia.com"
 *
 * DEV:
 *   Leave it empty; Vite proxy will handle /auth, /billing, etc.
 */
const viteBase =
  (isViteEnv &&
    (
      import.meta.env.VITE_API_BASE_URL ||
      import.meta.env.VITE_API_BASE ||
      import.meta.env.VITE_API_URL
    )) ||
  null;

// Optional: you *can* set window.__API_URL__ from index.html if you ever want.
const winBase =
  (isBrowser && window.__API_URL__) || null;

const nodeBase =
  (isNodeEnv &&
    (
      process.env.VITE_API_BASE_URL ||
      process.env.VITE_API_BASE ||
      process.env.VITE_API_URL
    )) ||
  null;

// Last-ditch fallback: same origin as the frontend
const sameOriginFallback =
  isBrowser && window.location
    ? window.location.origin
    : '';

const computedBase = viteBase || winBase || nodeBase || '';
const baseURL = computedBase || (isDev ? '' : sameOriginFallback);

if (isDev) {
  // Only log in dev to avoid noisy prod logs
  console.log('[axiosClient] baseURL =', baseURL || '(empty -> Vite proxy)');
}

/** -------- Axios instance -------- */
const axiosClient = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 20000,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-CSRF-Token',
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

/** -------- Helpers -------- */
function readCookie(name) {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

async function ensureCsrfPrimed() {
  const existing = axiosClient.defaults.headers.common['X-CSRF-Token'];
  if (existing) return;

  try {
    const res = await axiosClient.get('/auth/csrf', { withCredentials: true });
    const tokenFromBody = res?.data?.csrfToken || res?.data?.token;
    const tokenFromCookie = readCookie('XSRF-TOKEN');
    const token = tokenFromCookie || tokenFromBody;

    if (token) {
      axiosClient.defaults.headers.common['X-CSRF-Token'] = token;
    }
  } catch {
    // Fail silently – worst case, CSRF middleware will reject and you'll see it in logs
  }
}

/** -------- Interceptors -------- */

// Attach CSRF token for mutating requests
axiosClient.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toUpperCase();
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isMutating) {
    await ensureCsrfPrimed();

    const cookieToken = readCookie('XSRF-TOKEN');
    const defaultToken =
      axiosClient.defaults.headers.common['X-CSRF-Token'] || null;
    const token = cookieToken || defaultToken;

    if (token) {
      config.headers = config.headers || {};
      config.headers['X-CSRF-Token'] = token;
    }

    if (isDev && !token) {
      console.warn('⚠️ No CSRF token available for mutating request:', config.url);
    }
  }

  return config;
});

// Helpful error log in dev
axiosClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (isDev && typeof window !== 'undefined') {
      console.error('axios error:', {
        url: err?.config?.url,
        method: err?.config?.method,
        status: err?.response?.status,
        data: err?.response?.data,
      });
    }
    return Promise.reject(err);
  }
);

export default axiosClient;

/** ------- Optional: explicit CSRF primer you can call on app start ------- */
let _csrfPrimed = false;
export async function primeCsrf() {
  if (_csrfPrimed) return;
  try {
    await axiosClient.get('/auth/csrf', { withCredentials: true });
  } catch {
    // ignore
  }
  _csrfPrimed = true;
}
