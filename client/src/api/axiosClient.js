import axios from 'axios';

/** -------- Env helpers -------- */
const isViteEnv =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env !== 'undefined';

const isBrowser = typeof window !== 'undefined';

const isDev = (isViteEnv && !!import.meta.env.DEV) || false;

/** -------- Base URL detection --------
 *
 * Canonical:
 *   VITE_API_BASE_URL
 *
 * Dev default:
 *   ''  (so Vite proxy handles /auth, /billing, /api, etc.)
 *
 * Prod default:
 *   window.location.origin (only as a last resort)
 */
const viteBase =
  (isViteEnv &&
    (
      import.meta.env.VITE_API_BASE_URL ||   // ✅ canonical
      import.meta.env.VITE_API_BASE ||       // ⚠️ legacy fallback (remove later)
      import.meta.env.VITE_API_URL           // ⚠️ legacy fallback (remove later)
    )) ||
  '';

const winBase = (isBrowser && window.__API_URL__) || '';

const sameOriginFallback =
  isBrowser && window.location ? window.location.origin : '';

/**
 * Decision:
 * - In dev: prefer empty baseURL so Vite proxy works
 * - Otherwise: use env if set, else same-origin
 */
const computedBase = winBase || viteBase;
const baseURL = isDev ? (computedBase || '') : (computedBase || sameOriginFallback);

if (isDev) {
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
    // silent
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
    const defaultToken = axiosClient.defaults.headers.common['X-CSRF-Token'] || null;
    const token = cookieToken || defaultToken;

    if (token) {
      config.headers = config.headers || {};
      config.headers['X-CSRF-Token'] = token;
    } else if (isDev) {
      console.warn('⚠️ No CSRF token available for mutating request:', config.url);
    }
  }

  return config;
});

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
