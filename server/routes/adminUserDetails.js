import express from 'express';

import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  editUserDetails,
  readUserDetails,
  UserDetailsError,
} from '../security/adminUserDetails.js';
import database from '../utils/prismaClient.js';

export function createAdminUserDetailsRouter({
  db = database,
  authenticate = requireAuth,
  authorize = requireAdmin,
} = {}) {
  const router = express.Router();
  router.use(authenticate, authorize);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const safe = (callback) => async (req, res) => {
    try {
      res.json(await callback(req));
    } catch (error) {
      res
        .status(error instanceof UserDetailsError ? error.status : 503)
        .json({
          error:
            error instanceof UserDetailsError
              ? error.message
              : 'User operation temporarily unavailable',
        });
    }
  };
  router.get(
    '/:id',
    safe((req) => readUserDetails(db, Number(req.params.id), true))
  );
  router.patch(
    '/:id',
    safe((req) =>
      editUserDetails(db, {
        actorUserId: req.user.id,
        authentication: req.auth,
        targetUserId: Number(req.params.id),
        body: req.body,
      })
    )
  );
  return router;
}
export default createAdminUserDetailsRouter();
