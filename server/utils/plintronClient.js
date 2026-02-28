import * as ESIM_CFG from '../config/esim.js';

const PLINTRON = ESIM_CFG.PLINTRON ?? (ESIM_CFG.getEsimProviderConfig ? ESIM_CFG.getEsimProviderConfig() : undefined) ?? {};

import fetch from 'node-fetch';
import AbortController from 'abort-controller';

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_BODY_PREVIEW = 1024;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt, base = 300) {
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.floor(Math.random() * exp);
}

export async function plintronRequest(
  path,
  { method = 'GET', body, timeout = DEFAULT_TIMEOUT, attempts = DEFAULT_ATTEMPTS } = {}
) {
  if (!PLINTRON?.baseUrl) {
    throw new Error('PLINTRON.baseUrl is not configured');
  }

  const url = new URL(path, PLINTRON.baseUrl).toString();
  const headers = { 'Content-Type': 'application/json' };

  if (PLINTRON.apiKey) {
    headers.Authorization = `Bearer ${PLINTRON.apiKey}`;
  }

  let lastErr = null;

  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const textBody = await res.text().catch(() => '');

      if (!res.ok) {
        const preview = textBody.slice(0, MAX_BODY_PREVIEW);
        const err = new Error(
          `[PLINTRON] ${method} ${url} failed: ${res.status} ${res.statusText} — ${preview}`
        );
        err.status = res.status;
        err.providerBody = preview;

        if (res.status >= 500 && attempt < attempts) {
          lastErr = err;
          await sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      }

      try {
        return JSON.parse(textBody || '{}');
      } catch {
        return {};
      }
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err.name === 'AbortError' || err.type === 'aborted';
      const retryable = isAbort || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN';

      if (attempt < attempts && retryable) {
        lastErr = err;
        await sleep(backoffMs(attempt));
        continue;
      }

      if (isAbort) {
        const e = new Error(`[PLINTRON] request timed out after ${timeout}ms for ${method} ${url}`);
        e.code = 'PLINTRON_TIMEOUT';
        throw e;
      }
      throw err;
    }
  }

  throw lastErr || new Error('[PLINTRON] unknown error');
}

export default plintronRequest;