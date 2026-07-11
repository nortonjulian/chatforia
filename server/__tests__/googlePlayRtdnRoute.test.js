/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

import express from 'express';
import request from 'supertest';

import {
  createGooglePlayRtdnRouter,
} from '../routes/googlePlayRtdn.js';

function buildApp({
  verifyRequest,
  processPush,
}) {
  const logEntries = [];

  const app = express();

  app.use(express.json());

  app.use((req, _res, next) => {
    req.log = {
      info: (...args) => {
        logEntries.push({
          level: 'info',
          args,
        });
      },

      warn: (...args) => {
        logEntries.push({
          level: 'warn',
          args,
        });
      },

      error: (...args) => {
        logEntries.push({
          level: 'error',
          args,
        });
      },
    };

    next();
  });

  app.use(
    '/billing',
    createGooglePlayRtdnRouter({
      verifyRequest,
      processPush,
    })
  );

  app.use(
    (error, _req, res, _next) => {
      return res
        .status(error?.statusCode || 500)
        .json({
          ok: false,

          code:
            error?.code ||
            'INTERNAL_ERROR',
        });
    }
  );

  return {
    app,
    logEntries,
  };
}

function buildSuccessDependencies() {
  return {
    verifyRequest:
      jest.fn().mockResolvedValue({
        email:
          'pubsub@example.iam.gserviceaccount.com',
      }),

    processPush:
      jest.fn().mockResolvedValue({
        eventId: 'event-1',
        status: 'PROCESSED',
        duplicate: false,

        googlePlaySubscriptionId:
          'google-sub-1',
      }),
  };
}

describe(
  'POST /billing/google-play/rtdn',
  () => {
    test(
      'authenticates, processes, and acknowledges a push',
      async () => {
        const dependencies =
          buildSuccessDependencies();

        const {
          app,
          logEntries,
        } = buildApp(dependencies);

        const body = {
          message: {
            messageId: 'message-1',
            data: 'encoded-data',
          },
        };

        const response =
          await request(app)
            .post(
              '/billing/google-play/rtdn'
            )
            .set(
              'Authorization',
              'Bearer secret-signed-token'
            )
            .send(body);

        expect(response.status)
          .toBe(204);

        expect(response.text)
          .toBe('');

        expect(
          dependencies.verifyRequest
        ).toHaveBeenCalledTimes(1);

        expect(
          dependencies.processPush
        ).toHaveBeenCalledWith(body);

        expect(
          JSON.stringify(logEntries)
        ).not.toContain(
          'secret-signed-token'
        );
      }
    );

    test(
      'acknowledges a durable unmatched result',
      async () => {
        const dependencies =
          buildSuccessDependencies();

        dependencies.processPush
          .mockResolvedValue({
            eventId: 'event-2',
            status: 'UNMATCHED',
            duplicate: false,

            googlePlaySubscriptionId:
              null,
          });

        const {
          app,
        } = buildApp(dependencies);

        const response =
          await request(app)
            .post(
              '/billing/google-play/rtdn'
            )
            .set(
              'Authorization',
              'Bearer signed-token'
            )
            .send({
              message: {
                messageId: 'message-2',
              },
            });

        expect(response.status)
          .toBe(204);
      }
    );

    test(
      'rejects an invalid Pub/Sub identity',
      async () => {
        const dependencies =
          buildSuccessDependencies();

        dependencies.verifyRequest
          .mockRejectedValue(
            Object.assign(
              new Error(
                'Invalid identity'
              ),
              {
                statusCode: 401,

                code:
                  'GOOGLE_PLAY_RTDN_TOKEN_INVALID',
              }
            )
          );

        const {
          app,
        } = buildApp(dependencies);

        const response =
          await request(app)
            .post(
              '/billing/google-play/rtdn'
            )
            .set(
              'Authorization',
              'Bearer invalid-token'
            )
            .send({
              message: {},
            });

        expect(response.status)
          .toBe(401);

        expect(response.body)
          .toEqual({
            ok: false,

            code:
              'GOOGLE_PLAY_RTDN_TOKEN_INVALID',
          });

        expect(
          dependencies.processPush
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'returns 503 for retryable processing failures',
      async () => {
        const dependencies =
          buildSuccessDependencies();

        dependencies.processPush
          .mockRejectedValue(
            Object.assign(
              new Error(
                'Temporary provider failure'
              ),
              {
                statusCode: 503,

                code:
                  'GOOGLE_PLAY_RTDN_RETRY_REQUIRED',
              }
            )
          );

        const {
          app,
        } = buildApp(dependencies);

        const response =
          await request(app)
            .post(
              '/billing/google-play/rtdn'
            )
            .set(
              'Authorization',
              'Bearer signed-token'
            )
            .send({
              message: {},
            });

        expect(response.status)
          .toBe(503);

        expect(response.body.code)
          .toBe(
            'GOOGLE_PLAY_RTDN_RETRY_REQUIRED'
          );
      }
    );

    test(
      'passes permanent malformed-push errors to the error handler',
      async () => {
        const dependencies =
          buildSuccessDependencies();

        dependencies.processPush
          .mockRejectedValue(
            Object.assign(
              new Error(
                'Malformed Pub/Sub body'
              ),
              {
                statusCode: 400,

                code:
                  'GOOGLE_PLAY_RTDN_MESSAGE_INVALID',
              }
            )
          );

        const {
          app,
        } = buildApp(dependencies);

        const response =
          await request(app)
            .post(
              '/billing/google-play/rtdn'
            )
            .set(
              'Authorization',
              'Bearer signed-token'
            )
            .send({
              invalid: true,
            });

        expect(response.status)
          .toBe(400);

        expect(response.body.code)
          .toBe(
            'GOOGLE_PLAY_RTDN_MESSAGE_INVALID'
          );
      }
    );
  }
);
