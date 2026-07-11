import express from 'express';

import {
  verifyGooglePlayRtdnRequest,
} from '../services/googlePlayRtdnAuthService.js';

import {
  processGooglePlayRtdnPush,
} from '../services/googlePlayRtdnService.js';

function safeStatusCode(error) {
  const value = Number(
    error?.statusCode
  );

  if (
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
  ) {
    return value;
  }

  return 500;
}

function safeErrorCode(error) {
  return String(
    error?.code ||
    'GOOGLE_PLAY_RTDN_REQUEST_FAILED'
  ).slice(0, 100);
}

export function createGooglePlayRtdnRouter({
  verifyRequest =
    verifyGooglePlayRtdnRequest,

  processPush =
    processGooglePlayRtdnPush,
} = {}) {
  const router = express.Router();

  router.post(
    '/google-play/rtdn',
    async (req, res, next) => {
      try {
        await verifyRequest(req);

        const result =
          await processPush(req.body);

        req.log?.info?.(
          {
            eventId:
              result?.eventId ?? null,

            status:
              result?.status ?? null,

            duplicate:
              Boolean(result?.duplicate),

            googlePlaySubscriptionId:
              result
                ?.googlePlaySubscriptionId ??
              null,
          },
          'Google Play RTDN push processed'
        );

        return res.status(204).end();
      } catch (error) {
        const statusCode =
          safeStatusCode(error);

        const logMethod =
          statusCode >= 500
            ? 'error'
            : 'warn';

        req.log?.[logMethod]?.(
          {
            statusCode,

            code:
              safeErrorCode(error),
          },
          'Google Play RTDN push rejected'
        );

        return next(error);
      }
    }
  );

  return router;
}

export default createGooglePlayRtdnRouter();
