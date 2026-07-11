/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

import {
  initGooglePlayReconciliation,
} from '../cron/googlePlayReconciliation.js';

function buildLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function buildTimers() {
  const state = {
    intervalCallback: null,
    intervalMs: null,
    timeoutCallback: null,
    timeoutMs: null,
    intervalHandle: {
      type: 'interval',
    },
    timeoutHandle: {
      type: 'timeout',
    },
  };

  return {
    state,

    setIntervalFn:
      jest.fn((callback, milliseconds) => {
        state.intervalCallback =
          callback;

        state.intervalMs =
          milliseconds;

        return state.intervalHandle;
      }),

    clearIntervalFn:
      jest.fn(),

    setTimeoutFn:
      jest.fn((callback, milliseconds) => {
        state.timeoutCallback =
          callback;

        state.timeoutMs =
          milliseconds;

        return state.timeoutHandle;
      }),

    clearTimeoutFn:
      jest.fn(),
  };
}

function deferred() {
  let resolve;
  let reject;

  const promise =
    new Promise(
      (resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      }
    );

  return {
    promise,
    resolve,
    reject,
  };
}

describe(
  'initGooglePlayReconciliation',
  () => {
    test(
      'does not schedule anything when disabled',
      async () => {
        const timers =
          buildTimers();

        const runBatch =
          jest.fn();

        const handle =
          initGooglePlayReconciliation({
            enabled: false,
            runBatch,
            loggerInstance:
              buildLogger(),
            ...timers,
          });

        expect(handle.enabled)
          .toBe(false);

        expect(
          timers.setIntervalFn
        ).not.toHaveBeenCalled();

        expect(
          timers.setTimeoutFn
        ).not.toHaveBeenCalled();

        await handle.runNow();

        expect(runBatch)
          .not.toHaveBeenCalled();
      }
    );

    test(
      'schedules and runs a reconciliation batch',
      async () => {
        const timers =
          buildTimers();

        const summary = {
          selected: 2,
          claimed: 2,
          refreshed: 2,
          failed: 0,
          leaseSkipped: 0,
          leaseReleaseFailed: 0,
        };

        const runBatch =
          jest.fn().mockResolvedValue(
            summary
          );

        const loggerInstance =
          buildLogger();

        const handle =
          initGooglePlayReconciliation({
            enabled: true,

            intervalMs:
              90 * 60 * 1000,

            initialDelayMs:
              45 * 1000,

            runBatch,
            loggerInstance,
            ...timers,
          });

        expect(handle.enabled)
          .toBe(true);

        expect(timers.state.intervalMs)
          .toBe(90 * 60 * 1000);

        expect(timers.state.timeoutMs)
          .toBe(45 * 1000);

        const result =
          await handle.runNow();

        expect(result)
          .toEqual(summary);

        expect(runBatch)
          .toHaveBeenCalledTimes(1);

        expect(
          loggerInstance.info
        ).toHaveBeenCalledWith(
          {
            task:
              'googlePlayReconciliation',

            ...summary,
          },
          'Google Play reconciliation batch completed'
        );
      }
    );

    test(
      'prevents overlapping runs',
      async () => {
        const timers =
          buildTimers();

        const pending =
          deferred();

        const runBatch =
          jest.fn().mockReturnValue(
            pending.promise
          );

        const loggerInstance =
          buildLogger();

        const handle =
          initGooglePlayReconciliation({
            enabled: true,
            runBatch,
            loggerInstance,
            ...timers,
          });

        const first =
          handle.runNow();

        const second =
          handle.runNow();

        expect(runBatch)
          .toHaveBeenCalledTimes(1);

        pending.resolve({
          selected: 0,
          claimed: 0,
          refreshed: 0,
          failed: 0,
          leaseSkipped: 0,
          leaseReleaseFailed: 0,
        });

        await Promise.all([
          first,
          second,
        ]);

        expect(
          loggerInstance.warn
        ).toHaveBeenCalledWith(
          {
            task:
              'googlePlayReconciliation',
          },
          'Google Play reconciliation run skipped because a prior run is still active'
        );
      }
    );

    test(
      'logs a top-level batch failure without rejecting the scheduler',
      async () => {
        const timers =
          buildTimers();

        const loggerInstance =
          buildLogger();

        const runBatch =
          jest.fn().mockRejectedValue(
            Object.assign(
              new Error(
                'database unavailable'
              ),
              {
                code: 'P1001',
              }
            )
          );

        const handle =
          initGooglePlayReconciliation({
            enabled: true,
            runBatch,
            loggerInstance,
            ...timers,
          });

        await expect(
          handle.runNow()
        ).resolves.toBeNull();

        expect(
          loggerInstance.error
        ).toHaveBeenCalledWith(
          {
            task:
              'googlePlayReconciliation',

            code: 'P1001',

            message:
              'database unavailable',
          },
          'Google Play reconciliation batch failed'
        );
      }
    );

    test(
      'clears timers and waits for an active batch during shutdown',
      async () => {
        const timers =
          buildTimers();

        const pending =
          deferred();

        const handle =
          initGooglePlayReconciliation({
            enabled: true,

            runBatch:
              jest.fn().mockReturnValue(
                pending.promise
              ),

            loggerInstance:
              buildLogger(),

            ...timers,
          });

        const activeRun =
          handle.runNow();

        let stopResolved = false;

        const stopping =
          handle.stop().then(() => {
            stopResolved = true;
          });

        await Promise.resolve();

        expect(stopResolved)
          .toBe(false);

        expect(
          timers.clearIntervalFn
        ).toHaveBeenCalledWith(
          timers.state.intervalHandle
        );

        expect(
          timers.clearTimeoutFn
        ).toHaveBeenCalledWith(
          timers.state.timeoutHandle
        );

        pending.resolve({
          selected: 0,
          claimed: 0,
          refreshed: 0,
          failed: 0,
          leaseSkipped: 0,
          leaseReleaseFailed: 0,
        });

        await activeRun;
        await stopping;

        expect(stopResolved)
          .toBe(true);
      }
    );
  }
);
