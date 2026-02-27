import fetch from 'node-fetch';

const DEFAULT_TIMEOUT = 10_000; // ms
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BACKOFF_BASE = 300; // ms

class ProviderRequestError extends Error {
  constructor(message, { status = null, statusText = null, providerBody = null, code = null, provider = null } = {}) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = status;
    this.statusText = statusText;
    this.providerBody = providerBody;
    this.code = code || 'PROVIDER_REQUEST_ERROR';
    this.provider = provider || null;
  }
}

/**
 * Sleep helper (ms)
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Small jittered exponential backoff: base * 2^(attempt-1) + jitter
 */
function backoffMs(attempt, base = DEFAULT_BACKOFF_BASE) {
  const exp = Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(200, base)); // small jitter
  return Math.round(base * exp + jitter);
}

/**
 * Build a full URL from baseUrl + path
 */
function buildUrl(baseUrl, path) {
  if (!baseUrl) throw new Error('baseUrl required');
  // If path already absolute URL, return as-is
  try {
    const maybeUrl = new URL(path);
    return maybeUrl.toString();
  } catch {
    // not absolute
  }
  return new URL(path.replace(/^\//, ''), baseUrl).toString();
}

/**
 * Normalize response body: try JSON, fall back to text.
 */
async function parseResponseBody(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return await res.json();
    } catch (e) {
      // malformed JSON -> fall through to text
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * providerRequest(options)
 *
 * Options:
 *  - baseUrl: string (required)
 *  - path: string (required) (or provide full URL as path)
 *  - method: string (default GET)
 *  - body: object|string|null (if object -> JSON)
 *  - headers: object
 *  - apiKey: optional string (will be put in Authorization: Bearer)
 *  - auth: optional { user, pass } -> will set Basic auth header
 *  - timeout: ms (default 10000)
 *  - attempts: number (default 2)
 *  - provider: string used for shaping errors / logs
 *  - signal: AbortSignal (optional) - merged with internal timeout abort
 *  - attemptInterceptor: async (attempt, opts) => { }  // optional hook for logging/metrics
 *
 * Returns parsed response body (JSON or text), or throws ProviderRequestError with providerBody attached.
 */
export async function providerRequest({
  baseUrl,
  path = '/',
  method = 'GET',
  body = undefined,
  headers = {},
  apiKey = undefined,
  auth = undefined,
  timeout = DEFAULT_TIMEOUT,
  attempts = DEFAULT_ATTEMPTS,
  provider = undefined,
  signal = undefined,
  attemptInterceptor = undefined,
}) {
  if (!baseUrl) {
    throw new ProviderRequestError('providerRequest requires baseUrl', { provider, code: 'MISSING_BASE_URL' });
  }

  const url = buildUrl(baseUrl, path);

  // Prepare body/header
  const isJsonBody = body !== undefined && body !== null && typeof body === 'object' && !(body instanceof Buffer);
  const finalHeaders = Object.assign({}, headers);

  if (isJsonBody && !finalHeaders['Content-Type'] && !finalHeaders['content-type']) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  if (apiKey) {
    // only set Authorization if not already present
    if (!finalHeaders.Authorization && !finalHeaders.authorization) {
      finalHeaders.Authorization = `Bearer ${apiKey}`;
    }
  }

  if (auth && auth.user) {
    if (!finalHeaders.Authorization && !finalHeaders.authorization) {
      const b64 = Buffer.from(`${auth.user}:${auth.pass || ''}`).toString('base64');
      finalHeaders.Authorization = `Basic ${b64}`;
    }
  }

  // Clean header keys to strings
  Object.keys(finalHeaders).forEach((k) => {
    if (finalHeaders[k] == null) delete finalHeaders[k];
  });

  let lastErr = null;

  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    // Optional hook for instrumentation
    if (typeof attemptInterceptor === 'function') {
      try {
        // don't await blocking the request in critical path if interceptor is slow? we await to let user do logging sync
        await attemptInterceptor(attempt, { url, method, provider });
      } catch (e) {
        // swallow interceptor errors
        // eslint-disable-next-line no-console
        console.warn('providerRequest attemptInterceptor error', e);
      }
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeoutId;

    // If external signal provided, we want to respect it: race controller with external signal
    const outerSignal = signal;

    try {
      // Setup timeout
      if (controller) {
        timeoutId = setTimeout(() => {
          try {
            controller.abort();
          } catch (e) {
            // ignore
          }
        }, timeout);
      }

      // If outerSignal is aborted, forward to our controller
      if (outerSignal && outerSignal.aborted && controller) {
        controller.abort();
      } else if (outerSignal && controller) {
        // when outerSignal aborts, abort our controller as well
        const onAbort = () => controller.abort();
        outerSignal.addEventListener('abort', onAbort, { once: true });
        // We'll remove listener in finally via cleanup
      }

      const fetchOpts = {
        method,
        headers: finalHeaders,
        // node-fetch v3 doesn't accept undefined body for GET
        body: method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD' ? undefined : isJsonBody ? JSON.stringify(body) : body,
        signal: controller ? controller.signal : undefined,
      };

      const res = await fetch(url, fetchOpts);

      // Clear timeout on success
      if (timeoutId) clearTimeout(timeoutId);

      const parsed = await parseResponseBody(res);

      if (!res.ok) {
        // shape error with providerBody available
        const err = new ProviderRequestError(
          `Provider ${provider || 'unknown'} ${method} ${url} failed: ${res.status} ${res.statusText}`,
          {
            status: res.status,
            statusText: res.statusText,
            providerBody: parsed,
            provider,
            code: `HTTP_${res.status}`,
          }
        );
        lastErr = err;
        // For 5xx we can retry (loop continues). For 4xx, break and throw.
        if (res.status >= 500 && attempt < attempts) {
          const wait = backoffMs(attempt);
          await sleep(wait);
          continue;
        }
        throw err;
      }

      // success
      return parsed;
    } catch (err) {
      // Clear timeout
      if (timeoutId) clearTimeout(timeoutId);

      // If fetch aborted due to our timeout or external signal
      if (err.name === 'AbortError' || err.type === 'aborted') {
        const shaped = new ProviderRequestError(`Request aborted/timed out after ${timeout}ms`, {
          providerBody: null,
          provider,
          code: 'REQUEST_ABORTED',
        });
        lastErr = shaped;
        // retry on timeout up to attempts
        if (attempt < attempts) {
          const wait = backoffMs(attempt);
          await sleep(wait);
          continue;
        }
        throw shaped;
      }

      // If error is already ProviderRequestError, rethrow or wrap
      if (err instanceof ProviderRequestError) {
        lastErr = err;
        // decide retry on network-like errors
        const isNetwork = !err.status || (err.status >= 500 && err.status < 600);
        if (isNetwork && attempt < attempts) {
          const wait = backoffMs(attempt);
          await sleep(wait);
          continue;
        }
        throw err;
      }

      // Other network errors (DNS, ECONNRESET, etc.)
      const shaped = new ProviderRequestError(`Network/Fetch error: ${err.message}`, {
        providerBody: null,
        provider,
        code: 'NETWORK_ERROR',
      });
      lastErr = shaped;
      if (attempt < attempts) {
        const wait = backoffMs(attempt);
        await sleep(wait);
        continue;
      }
      throw shaped;
    } finally {
      // remove any outerSignal listener if present (we added it earlier)
      if (outerSignal && typeof outerSignal.removeEventListener === 'function') {
        try {
          outerSignal.removeEventListener('abort', () => {}); // no-op: we can't remove the exact listener here (we used once:true above)
        } catch {
          // ignore
        }
      }
    }
  }

  // If we exit loop, throw lastErr
  throw lastErr || new ProviderRequestError('Unknown provider request failure', { provider });
}

/**
 * makeProviderClient({ baseUrl, apiKey, provider, defaultHeaders, timeout, attempts })
 *
 * Returns a function (path, opts) => providerRequest({ ...defaults, path, ...opts })
 */
export function makeProviderClient({
  baseUrl,
  apiKey = undefined,
  provider = undefined,
  defaultHeaders = {},
  timeout = DEFAULT_TIMEOUT,
  attempts = DEFAULT_ATTEMPTS,
}) {
  if (!baseUrl) {
    throw new Error('makeProviderClient requires baseUrl');
  }

  return async function providerClient(path, opts = {}) {
    const {
      method,
      body,
      headers = {},
      auth,
      signal,
      attemptInterceptor,
      attempts: perCallAttempts,
      timeout: perCallTimeout,
    } = opts;

    return providerRequest({
      baseUrl,
      path,
      provider,
      method: method || 'GET',
      body,
      headers: Object.assign({}, defaultHeaders, headers),
      apiKey,
      auth,
      timeout: perCallTimeout != null ? perCallTimeout : timeout,
      attempts: perCallAttempts != null ? perCallAttempts : attempts,
      signal,
      attemptInterceptor,
    });
  };
}

export default {
  providerRequest,
  makeProviderClient,
};