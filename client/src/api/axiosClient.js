import axios from 'axios';

/** Vite replaces this in application builds; the Babel plugin maps it to
 * process.env for Jest. Avoid testing `typeof import.meta`, which CommonJS
 * cannot parse before that transform runs. */
const viteEnv = import.meta.env || {};
const isBrowser = typeof window !== 'undefined';
const isDev = Boolean(viteEnv.DEV);

const viteBase =
  viteEnv.VITE_API_BASE_URL ||
  viteEnv.VITE_API_BASE ||
  viteEnv.VITE_API_URL ||
  '';

const winBase = (isBrowser && window.__API_URL__) || '';
const sameOriginFallback =
  isBrowser && window.location ? window.location.origin : '';
const computedBase = winBase || viteBase;
const baseURL = isDev ? computedBase || '' : computedBase || sameOriginFallback;

if (isDev) {
  console.log('[axiosClient] baseURL =', baseURL || '(empty -> Vite proxy)');
}

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

function readCookie(name) {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

async function ensureCsrfPrimed() {
  const existing = axiosClient.defaults.headers.common['X-CSRF-Token'];
  if (existing) return;

  try {
    const response = await axiosClient.get('/auth/csrf', { withCredentials: true });
    const bodyToken = response?.data?.csrfToken || response?.data?.token;
    const token = readCookie('XSRF-TOKEN') || bodyToken;
    if (token) axiosClient.defaults.headers.common['X-CSRF-Token'] = token;
  } catch {
    // The request interceptor will continue without a token.
  }
}

function shouldSuppressDevAxiosError(error) {
  const url = error?.config?.url || '';
  const method = String(error?.config?.method || 'get').toLowerCase();
  return method === 'get' && url === '/auth/me' && error?.response?.status === 401;
}

axiosClient.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toUpperCase();
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isMutating) {
    await ensureCsrfPrimed();
    const token =
      readCookie('XSRF-TOKEN') ||
      axiosClient.defaults.headers.common['X-CSRF-Token'] ||
      null;

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
  (response) => response,
  (error) => {
    if (isDev && isBrowser && !shouldSuppressDevAxiosError(error)) {
      console.error('axios error:', {
        url: error?.config?.url,
        method: error?.config?.method,
        status: error?.response?.status,
        data: error?.response?.data,
      });
    }
    return Promise.reject(error);
  }
);

export default axiosClient;

let csrfPrimed = false;
export async function primeCsrf() {
  if (csrfPrimed) return;
  try {
    await axiosClient.get('/auth/csrf', { withCredentials: true });
  } catch {
    // A later mutating request can retry CSRF initialization.
  }
  csrfPrimed = true;
}
