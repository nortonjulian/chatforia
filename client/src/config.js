const isDev = Boolean(import.meta.env?.DEV);

const runtimeApi =
  typeof window !== 'undefined' ? window.__API_URL__ : '';

const runtimeWs =
  typeof window !== 'undefined' ? window.__WS_URL__ : '';

export const API_BASE_URL = (
  runtimeApi ||
  import.meta.env?.VITE_API_BASE_URL ||
  import.meta.env?.VITE_API_ORIGIN ||
  (isDev ? 'http://localhost:5002' : 'https://api.chatforia.com')
).replace(/\/$/, '');

export const WS_URL = (
  runtimeWs ||
  import.meta.env?.VITE_WS_URL ||
  API_BASE_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
).replace(/\/$/, '');

export const API_BASE = API_BASE_URL;
export const SOCKET_URL = WS_URL;

export default { API_BASE_URL, WS_URL, API_BASE, SOCKET_URL };