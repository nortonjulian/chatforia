import fetch from 'node-fetch';
import AbortController from 'abort-controller';
import crypto from 'node:crypto';
import { getEsimProviderConfig } from '../config/esim.js';

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_BODY_PREVIEW = 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt, base = 300) {
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.floor(Math.random() * exp);
}

function createRequestId() {
  return crypto.randomUUID();
}

export async function telnaRequest(
  path,
  {
    method = 'GET',
    body,
    timeout = DEFAULT_TIMEOUT,
    attempts = DEFAULT_ATTEMPTS,
  } = {}
) {
  const TELNA = getEsimProviderConfig('telna');

  if (!TELNA?.baseUrl) {
    const err = new Error('TELNA.baseUrl is not configured');
    err.code = 'TELNA_NOT_CONFIGURED';
    throw err;
  }

  if (!TELNA?.apiKey) {
    const err = new Error('TELNA.apiKey is not configured');
    err.code = 'TELNA_NOT_CONFIGURED';
    throw err;
  }

  const url = new URL(path, TELNA.baseUrl).toString();

  /*
   * Telna v2 uses Bearer authentication.
   *
   * Request-ID is a client-generated reference that Telna returns in
   * its response headers and can use when troubleshooting a request.
   *
   * Keep the same Request-ID across retries because the retries are
   * attempts of the same logical Chatforia -> Telna request.
   *
   * Telna's Version header is intentionally omitted. Telna documents
   * that an omitted Version header defaults to the latest available
   * API version. The API path itself identifies the v2.1 endpoints
   * Chatforia uses.
   */
  const requestId = createRequestId();

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TELNA.apiKey}`,
    'Request-ID': requestId,
  };

  let lastErr = null;
  const maxAttempts = Math.max(1, attempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const textBody = await res.text().catch(() => '');

      if (!res.ok) {
        const preview = textBody.slice(0, MAX_BODY_PREVIEW);

        const err = new Error(
          `[TELNA] ${method} ${url} failed: ${res.status} ${res.statusText} — ${preview}`
        );

        err.status = res.status;
        err.providerBody = preview;
        err.requestId =
          res.headers?.get?.('request-id') ||
          requestId;

        if (res.status >= 500 && attempt < maxAttempts) {
          lastErr = err;
          await sleep(backoffMs(attempt));
          continue;
        }

        throw err;
      }

      /*
       * Some Telna operations may legitimately return an empty body
       * (for example, a 204 response). Do not force those responses
       * through JSON.parse().
       */
      if (!textBody) {
        return {};
      }

      try {
        return JSON.parse(textBody);
      } catch {
        return {};
      }
    } catch (err) {
      clearTimeout(timer);

      const isAbort =
        err.name === 'AbortError' ||
        err.type === 'aborted';

      const retryable =
        isAbort ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ENOTFOUND' ||
        err.code === 'EAI_AGAIN';

      if (attempt < maxAttempts && retryable) {
        lastErr = err;
        await sleep(backoffMs(attempt));
        continue;
      }

      if (isAbort) {
        const timeoutError = new Error(
          `[TELNA] request timed out after ${timeout}ms for ${method} ${url}`
        );

        timeoutError.code = 'TELNA_TIMEOUT';
        timeoutError.requestId = requestId;

        throw timeoutError;
      }

      if (!err.requestId) {
        err.requestId = requestId;
      }

      throw err;
    }
  }

  if (lastErr) {
    if (!lastErr.requestId) {
      lastErr.requestId = requestId;
    }

    throw lastErr;
  }

  const err = new Error('[TELNA] unknown error');
  err.requestId = requestId;
  throw err;
}

export default telnaRequest;
