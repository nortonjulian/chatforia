import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const reconcileEsimReplacementMock =
  jest.fn();

const retryFailedEsimReplacementMock =
  jest.fn();

jest.unstable_mockModule(
  '../services/esimReplacementService.js',
  () => ({
    reconcileEsimReplacement:
      reconcileEsimReplacementMock,
    retryFailedEsimReplacement:
      retryFailedEsimReplacementMock,
  })
);

jest.unstable_mockModule(
  '../middleware/auth.js',
  () => ({
    requireAuth: (req, res, next) => {
      if (!req.user?.id) {
        return res
          .status(401)
          .json({ error: 'Unauthorized' });
      }

      return next();
    },

    requireAdmin: (req, res, next) => {
      if (
        !req.user ||
        req.user.role !== 'ADMIN'
      ) {
        return res.status(403).json({
          error: 'Admin access required',
        });
      }

      return next();
    },
  })
);

const {
  default: adminEsimReplacementsRouter,
} = await import(
  '../routes/adminEsimReplacements.js'
);

function makeApp(user = null) {
  const app = express();

  app.use(express.json());

  if (user) {
    app.use((req, _res, next) => {
      req.user = user;
      next();
    });
  }

  app.use(
    '/admin/esim-replacements',
    adminEsimReplacementsRouter
  );

  return app;
}

describe('admin eSIM replacement reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reconcileEsimReplacementMock.mockReset();
    retryFailedEsimReplacementMock.mockReset();
  });

  test('requires authentication', async () => {
    const res = await request(
      makeApp()
    ).post(
      '/admin/esim-replacements/replacement-1/reconcile'
    );

    expect(res.status).toBe(401);

    expect(
      reconcileEsimReplacementMock
    ).not.toHaveBeenCalled();
  });

  test('requires ADMIN role', async () => {
    const res = await request(
      makeApp({
        id: 7,
        role: 'USER',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/reconcile'
    );

    expect(res.status).toBe(403);

    expect(
      reconcileEsimReplacementMock
    ).not.toHaveBeenCalled();
  });

  test('admin can reconcile a replacement', async () => {
    reconcileEsimReplacementMock
      .mockResolvedValueOnce({
        id: 'replacement-1',
        status: 'COMPLETED',
      });

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/reconcile'
    );

    expect(res.status).toBe(200);

    expect(
      reconcileEsimReplacementMock
    ).toHaveBeenCalledTimes(1);

    expect(
      reconcileEsimReplacementMock
    ).toHaveBeenCalledWith(
      'replacement-1'
    );

    expect(res.body).toEqual({
      ok: true,
      replacement: {
        id: 'replacement-1',
        status: 'COMPLETED',
      },
    });
  });

  test('unknown provider outcome remains blocked', async () => {
    reconcileEsimReplacementMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'Replacement package outcome is still unknown'
          ),
          {
            code:
              'ESIM_REPLACEMENT_PROVIDER_OUTCOME_UNKNOWN',
          }
        )
      );

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/reconcile'
    );

    expect(res.status).toBe(409);

    expect(res.body.code).toBe(
      'ESIM_REPLACEMENT_PROVIDER_OUTCOME_UNKNOWN'
    );
  });

  test('returns 404 for an unknown replacement', async () => {
    reconcileEsimReplacementMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'eSIM replacement not found'
          ),
          {
            code:
              'ESIM_REPLACEMENT_NOT_FOUND',
          }
        )
      );

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/missing/reconcile'
    );

    expect(res.status).toBe(404);

    expect(res.body.code).toBe(
      'ESIM_REPLACEMENT_NOT_FOUND'
    );
  });

  test('does not accept request-body provider identifiers', async () => {
    reconcileEsimReplacementMock
      .mockResolvedValueOnce({
        id: 'replacement-1',
        status: 'COMPLETED',
      });

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    )
      .post(
        '/admin/esim-replacements/replacement-1/reconcile'
      )
      .send({
        oldIccid: 'ATTACKER-ICCID',
        newProviderPurchaseId:
          'ATTACKER-PACKAGE',
        force: true,
      });

    expect(res.status).toBe(200);

    /*
     * The service receives only the trusted audit ID.
     * Provider identifiers from the body are ignored.
     */
    expect(
      reconcileEsimReplacementMock
    ).toHaveBeenCalledWith(
      'replacement-1'
    );
  });
});


describe('admin eSIM replacement retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reconcileEsimReplacementMock.mockReset();
    retryFailedEsimReplacementMock.mockReset();
  });

  test('requires authentication', async () => {
    const res = await request(
      makeApp()
    ).post(
      '/admin/esim-replacements/replacement-1/retry'
    );

    expect(res.status).toBe(401);

    expect(
      retryFailedEsimReplacementMock
    ).not.toHaveBeenCalled();
  });

  test('requires ADMIN role', async () => {
    const res = await request(
      makeApp({
        id: 7,
        role: 'USER',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/retry'
    );

    expect(res.status).toBe(403);

    expect(
      retryFailedEsimReplacementMock
    ).not.toHaveBeenCalled();
  });

  test('admin can retry a definite failed replacement', async () => {
    retryFailedEsimReplacementMock
      .mockResolvedValueOnce({
        id: 'replacement-1',
        status: 'COMPLETED',
      });

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/retry'
    );

    expect(res.status).toBe(200);

    expect(
      retryFailedEsimReplacementMock
    ).toHaveBeenCalledTimes(1);

    expect(
      retryFailedEsimReplacementMock
    ).toHaveBeenCalledWith(
      'replacement-1'
    );

    expect(res.body).toEqual({
      ok: true,
      replacement: {
        id: 'replacement-1',
        status: 'COMPLETED',
      },
    });
  });

  test('returns 409 when replacement is not retryable', async () => {
    retryFailedEsimReplacementMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'eSIM replacement is not eligible for retry'
          ),
          {
            code:
              'ESIM_REPLACEMENT_NOT_RETRYABLE',
          }
        )
      );

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/retry'
    );

    expect(res.status).toBe(409);

    expect(res.body.code).toBe(
      'ESIM_REPLACEMENT_NOT_RETRYABLE'
    );
  });

  test('returns 409 when another retry already owns the workflow', async () => {
    retryFailedEsimReplacementMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'eSIM replacement retry was already claimed'
          ),
          {
            code:
              'ESIM_REPLACEMENT_RETRY_ALREADY_CLAIMED',
          }
        )
      );

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/retry'
    );

    expect(res.status).toBe(409);

    expect(res.body.code).toBe(
      'ESIM_REPLACEMENT_RETRY_ALREADY_CLAIMED'
    );
  });

  test('returns 409 when reusable allocation is missing', async () => {
    retryFailedEsimReplacementMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'Failed replacement has no reusable allocation'
          ),
          {
            code:
              'ESIM_REPLACEMENT_RETRY_ALLOCATION_MISSING',
          }
        )
      );

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/retry'
    );

    expect(res.status).toBe(409);

    expect(res.body.code).toBe(
      'ESIM_REPLACEMENT_RETRY_ALLOCATION_MISSING'
    );
  });

  test('returns 409 when frozen retry entitlement has expired', async () => {
    retryFailedEsimReplacementMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'The eSIM package has already expired'
          ),
          {
            code:
              'ESIM_REPLACEMENT_EXPIRED',
          }
        )
      );

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/replacement-1/retry'
    );

    expect(res.status).toBe(409);

    expect(res.body.code).toBe(
      'ESIM_REPLACEMENT_EXPIRED'
    );
  });

  test('returns 404 for an unknown replacement', async () => {
    retryFailedEsimReplacementMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'eSIM replacement not found'
          ),
          {
            code:
              'ESIM_REPLACEMENT_NOT_FOUND',
          }
        )
      );

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    ).post(
      '/admin/esim-replacements/missing/retry'
    );

    expect(res.status).toBe(404);

    expect(res.body.code).toBe(
      'ESIM_REPLACEMENT_NOT_FOUND'
    );
  });

  test('does not accept request-body provider or entitlement data', async () => {
    retryFailedEsimReplacementMock
      .mockResolvedValueOnce({
        id: 'replacement-1',
        status: 'COMPLETED',
      });

    const res = await request(
      makeApp({
        id: 1,
        role: 'ADMIN',
      })
    )
      .post(
        '/admin/esim-replacements/replacement-1/retry'
      )
      .send({
        newIccid:
          'ATTACKER-ICCID',
        newProviderPurchaseId:
          'ATTACKER-PACKAGE',
        replacementDataMb:
          999999,
        replacementAddonKind:
          'ATTACKER-PLAN',
        force: true,
      });

    expect(res.status).toBe(200);

    /*
     * Only the trusted audit ID crosses the route/service boundary.
     * Frozen provider/allocation/entitlement state comes from the DB.
     */
    expect(
      retryFailedEsimReplacementMock
    ).toHaveBeenCalledWith(
      'replacement-1'
    );
  });
});
