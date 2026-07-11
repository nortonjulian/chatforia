import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';

import {
  runGooglePlayReconciliationBatch,
} from '../services/googlePlayReconciliationService.js';

const DEFAULT_INTERVAL_MS =
  60 * 60 * 1000;

const DEFAULT_INITIAL_DELAY_MS =
  30 * 1000;

function boundedInteger(
  value,
  fallback,
  {
    minimum = 0,
    maximum =
      Number.MAX_SAFE_INTEGER,
  } = {}
) {
  const normalized = Number(value);

  if (
    !Number.isInteger(normalized) ||
    normalized < minimum
  ) {
    return fallback;
  }

  return Math.min(
    normalized,
    maximum
  );
}

function safeErrorCode(error) {
  return String(
    error?.code ??
    error?.statusCode ??
    'GOOGLE_PLAY_RECONCILIATION_JOB_FAILED'
  ).slice(0, 100);
}

function safeErrorMessage(error) {
  return String(
    error?.message ||
    'Google Play reconciliation job failed.'
  ).slice(0, 500);
}

export function initGooglePlayReconciliation({
  enabled =
    ENV.GOOGLE_PLAY_RECONCILIATION_ENABLED,

  intervalMs =
    ENV.GOOGLE_PLAY_RECONCILIATION_INTERVAL_MS,

  initialDelayMs =
    DEFAULT_INITIAL_DELAY_MS,

  runBatch =
    runGooglePlayReconciliationBatch,

  loggerInstance = logger,

  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,

  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!enabled) {
    loggerInstance.info(
      {
        task:
          'googlePlayReconciliation',
      },
      'Google Play reconciliation is disabled'
    );

    return {
      enabled: false,

      runNow: async () => null,

      stop: async () => {},
    };
  }

  const normalizedIntervalMs =
    boundedInteger(
      intervalMs,
      DEFAULT_INTERVAL_MS,
      {
        minimum:
          60 * 1000,

        maximum:
          24 * 60 * 60 * 1000,
      }
    );

  const normalizedInitialDelayMs =
    boundedInteger(
      initialDelayMs,
      DEFAULT_INITIAL_DELAY_MS,
      {
        minimum: 0,

        maximum:
          normalizedIntervalMs,
      }
    );

  let stopped = false;
  let currentRun = null;

  const execute = () => {
    if (stopped) {
      return Promise.resolve(null);
    }

    if (currentRun) {
      loggerInstance.warn(
        {
          task:
            'googlePlayReconciliation',
        },
        'Google Play reconciliation run skipped because a prior run is still active'
      );

      return currentRun;
    }

    currentRun =
      (async () => {
        try {
          const summary =
            await runBatch();

          loggerInstance.info(
            {
              task:
                'googlePlayReconciliation',

              ...summary,
            },
            'Google Play reconciliation batch completed'
          );

          return summary;
        } catch (error) {
          loggerInstance.error(
            {
              task:
                'googlePlayReconciliation',

              code:
                safeErrorCode(error),

              message:
                safeErrorMessage(error),
            },
            'Google Play reconciliation batch failed'
          );

          return null;
        } finally {
          currentRun = null;
        }
      })();

    return currentRun;
  };

  const interval =
    setIntervalFn(
      () => {
        void execute();
      },
      normalizedIntervalMs
    );

  const initialTimeout =
    setTimeoutFn(
      () => {
        void execute();
      },
      normalizedInitialDelayMs
    );

  loggerInstance.info(
    {
      task:
        'googlePlayReconciliation',

      intervalMs:
        normalizedIntervalMs,

      initialDelayMs:
        normalizedInitialDelayMs,
    },
    'Google Play reconciliation scheduled'
  );

  const stop = async () => {
    if (stopped) {
      return;
    }

    stopped = true;

    clearIntervalFn(interval);
    clearTimeoutFn(initialTimeout);

    if (currentRun) {
      await currentRun;
    }
  };

  return {
    enabled: true,
    runNow: execute,
    stop,
  };
}
