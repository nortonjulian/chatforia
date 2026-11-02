import express from 'express';

import { requireAuth } from '../middleware/auth.js';
import { createRequireStaffPermission } from '../security/requireStaffPermission.js';
import { isEligibleStaffActor } from '../security/staffAccountEligibility.js';
import { lookupStaffAssignment } from '../security/staffAssignmentLookup.js';
import { grantOrChangeStaffAccess } from '../security/staffGrantService.js';
import {
  STAFF_PROFILES,
  DELEGATABLE_PROFILES,
} from '../security/staffPermissions.js';
import { revokeStaffAccess } from '../security/staffRevocationService.js';
import { staffCohortAllows } from '../security/staffRollout.js';
import database from '../utils/prismaClient.js';

const validId = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const validReason = (value) =>
  typeof value === 'string' &&
  value.trim().length >= 5 &&
  value.trim().length <= 500;

export function createStaffRouter({
  db = database,
  authenticate = requireAuth,
  grant = grantOrChangeStaffAccess,
  revoke = revokeStaffAccess,
} = {}) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (
      process.env.STAFF_SECURITY_ENABLED !== 'true' ||
      process.env.STAFF_DASHBOARD_ENABLED !== 'true'
    )
      return res.sendStatus(404);
    next();
  });
  router.use(authenticate);
  router.use((req, res, next) => staffCohortAllows(req.user?.id) ? next() : res.sendStatus(403));
  const permit = (permission) =>
    createRequireStaffPermission(permission, (id) =>
      lookupStaffAssignment(id, db)
    );
  const safe = (callback) => async (req, res) => {
    try {
      await callback(req, res);
    } catch {
      res
        .status(503)
        .json({ error: 'Staff operation unavailable. Refresh and try again.' });
    }
  };
  router.get(
    '/session',
    safe(async (req, res) => {
      if (!req.user?.twoFactorEnabled || req.auth?.mfaVerified !== true)
        return res.sendStatus(403);
      const assignment = await lookupStaffAssignment(req.user.id, db);
      if (!assignment) return res.sendStatus(403);
      res.json({
        profile: assignment.profile,
        permissions: STAFF_PROFILES[assignment.profile],
        delegatableProfiles: DELEGATABLE_PROFILES.filter((profile) =>
          ({
            CTO: ['ENGINEERING_MANAGER', 'SENIOR_ENGINEER'],
            ACCESS_ADMIN: ['SENIOR_ENGINEER', 'SUPPORT'],
          })[assignment.profile]?.includes(profile)
        ),
      });
    })
  );
  function listing(path, permission, model, select) {
    router.get(
      path,
      permit(permission),
      safe(async (req, res) => {
        const take = Number(req.query.take ?? 50),
          skip = Number(req.query.skip ?? 0);
        if (
          !Number.isSafeInteger(take) ||
          take < 1 ||
          take > 100 ||
          !Number.isSafeInteger(skip) ||
          skip < 0 ||
          skip > 100000
        )
          return res.sendStatus(400);
        const [items, total] = await Promise.all([
          db[model].findMany({ take, skip, orderBy: { id: 'desc' }, select }),
          db[model].count(),
        ]);
        res.json({ items, total });
      })
    );
  }
  listing('/assignments', 'staff.read', 'staffAssignment', {
    id: true,
    userId: true,
    profile: true,
    active: true,
    grantedAt: true,
    revokedAt: true,
  });
  listing('/users', 'users.read', 'user', {
    id: true,
    username: true,
    role: true,
    isBanned: true,
  });
  listing('/reports', 'reports.read', 'report', {
    id: true,
    reporterId: true,
    reportedUserId: true,
    reason: true,
    status: true,
    createdAt: true,
  });
  listing('/audit', 'audit.read', 'staffAccessEvent', {
    id: true,
    actorUserId: true,
    subjectUserId: true,
    action: true,
    previousProfile: true,
    newProfile: true,
    reason: true,
    createdAt: true,
  });
  router.post(
    '/reports/:reportId/resolve',
    permit('reports.resolve'),
    safe(async (req, res) => {
      const id = Number(req.params.reportId);
      const reason = req.body?.reason;
      if (!validId(id) || !validReason(reason)) return res.sendStatus(400);
      const result = await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(73421,1)::text`;
          await tx.$queryRaw`SELECT id FROM public."User" WHERE id=${req.user.id} FOR UPDATE`;
          const actor = await tx.user.findUnique({
            where: { id: req.user.id },
          });
          const assignment = await lookupStaffAssignment(req.user.id, tx);
          if (
            !isEligibleStaffActor(actor, req.auth) ||
            actor.tokenVersion !== req.auth.tokenVersion ||
            !assignment ||
            !STAFF_PROFILES[assignment.profile].includes('reports.resolve')
          )
            throw new Error('Staff session no longer authorized');
          const changed = await tx.report.updateMany({
            where: { id, status: 'OPEN' },
            data: {
              status: 'RESOLVED',
              resolvedAt: new Date(),
              notes: reason.trim(),
            },
          });
          if (changed.count !== 1) return { changed: false };
          await tx.auditLog.create({
            data: {
              actorId: req.user.id,
              action: 'REPORT_RESOLVED',
              resource: 'report',
              resourceId: String(id),
              status: 200,
              metadata: { reason: reason.trim() },
            },
          });
          return { changed: true };
        },
        { isolationLevel: 'Serializable' }
      );
      res.json(result);
    })
  );
  for (const action of ['grant', 'revoke']) {
    router.post(
      `/assignments/:userId/${action}`,
      permit('staff.assign'),
      safe(async (req, res) => {
        const targetUserId = Number(req.params.userId);
        const { reason, profile } = req.body || {};
        if (
          !validId(targetUserId) ||
          !validReason(reason) ||
          (action === 'grant' && !DELEGATABLE_PROFILES.includes(profile))
        )
          return res.sendStatus(400);
        const args = {
          actorUserId: req.user.id,
          targetUserId,
          authentication: req.auth,
          reason,
          db,
        };
        // Services repeat complete authorization under database locks. Client
        // actor IDs, MFA flags, versions and profile claims are never trusted.
        const result =
          action === 'grant'
            ? await grant({ ...args, targetProfile: profile })
            : await revoke(args);
        res.json(result);
      })
    );
  }
  return router;
}
export default createStaffRouter();
