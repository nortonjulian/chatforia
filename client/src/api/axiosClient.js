import axios from 'axios';

/** -------- Base URL detection (Vite first) -------- */
const viteBase =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL)) ||
  null;

const winBase =
  (typeof window !== 'undefined' && window.__API_URL__) || null;

const nodeBase =
  (typeof process !== 'undefined' &&
    process.env &&
    (process.env.VITE_API_BASE_URL || process.env.VITE_API_URL)) ||
  null;

const isDev = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;

// In dev use Vite proxy (`/api` → proxy → backend). In prod use configured base.
const computedBase = viteBase || winBase || nodeBase || '';
const baseURL = computedBase || '';

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
    // Fail silently
  }
}

/** -------- Interceptors -------- */

// Attach CSRF token for mutating requests
axiosClient.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toUpperCase();
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isMutating) {
    if (method === 'PATCH') {
      console.log('🔍 PATCH to:', config.url); // <—— added logging here
    }

    await ensureCsrfPrimed();

    const hasHeader =
      (config.headers &&
        (config.headers['X-CSRF-Token'] || config.headers['x-csrf-token'])) ||
      axiosClient.defaults.headers.common['X-CSRF-Token'];

    if (!hasHeader) {
      const token = readCookie('XSRF-TOKEN');
      if (token) {
        config.headers = config.headers || {};
        config.headers['X-CSRF-Token'] = token;
      }
    }
  }

  return config;
});

// Helpful error log in dev
axiosClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (typeof window !== 'undefined' && import.meta?.env?.DEV) {
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
  } catch {}
  _csrfPrimed = true;
}
