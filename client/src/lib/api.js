import axios from 'axios';

export const api = axios.create({
  withCredentials: true,
  baseURL: import.meta.env.VITE_API_BASE_URL, // e.g., https://api.chatforia.com
});

// Fetch CSRF cookie once on app start (or before first mutation)
export async function ensureCsrf() {
  try {
    await api.get('/auth/csrf-token');
  } catch {}
}

// Add header automatically if XSRF-TOKEN cookie exists
api.interceptors.request.use((config) => {
  const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/);
  if (m) config.headers['X-CSRF-Token'] = decodeURIComponent(m[1]);
  return config;
});
