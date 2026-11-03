import { createHash } from 'node:crypto';

import { hasVerifiedAdminAccess } from '../middleware/verifiedAdmin.js';

export const USER_EDIT_FIELDS = Object.freeze([
  'displayName',
  'preferredLanguage',
  'showReadReceipts',
  'showOriginalWithTranslation',
]);
const DETAIL_FIELDS = [
  'id',
  'username',
  'displayName',
  'role',
  'isBanned',
  'preferredLanguage',
  'showReadReceipts',
  'showOriginalWithTranslation',
];
const SELECT = Object.freeze({
  ...Object.fromEntries(DETAIL_FIELDS.map((field) => [field, true])),
  isSystem: true,
  isTestAccount: true,
  deletedAt: true,
  staffAssignment: { select: { id: true } },
  founderOwnership: { select: { id: true } },
});
export class UserDetailsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new UserDetailsError(status, message);
};
export const validUserId = (id) =>
  Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
const protectedIdentity = (user) =>
  user.role !== 'USER' ||
  user.staffAssignment != null ||
  user.founderOwnership != null ||
  user.isSystem !== false ||
  user.isTestAccount !== false;
const versionOf = (user) =>
  createHash('sha256')
    .update(JSON.stringify(USER_EDIT_FIELDS.map((field) => user[field])))
    .digest('hex');
function details(user, administrator) {
  return {
    user: Object.fromEntries(
      DETAIL_FIELDS.map((field) => [field, user[field]])
    ),
    editableFields:
      administrator && !protectedIdentity(user) ? USER_EDIT_FIELDS : [],
    version: versionOf(user),
  };
}
export async function readUserDetails(db, id, administrator = false) {
  if (!validUserId(id)) fail(400, 'Invalid user ID');
  const user = await db.user.findUnique({ where: { id }, select: SELECT });
  if (!user || user.deletedAt) fail(404, 'User unavailable');
  return details(user, administrator);
}
function changesFrom(body) {
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !['changes', 'version', 'reason'].includes(key)
    )
  )
    fail(400, 'Invalid edit request');
  if (typeof body.version !== 'string' || !/^[a-f0-9]{64}$/.test(body.version))
    fail(400, 'Reload current user values before editing');
  if (
    typeof body.reason !== 'string' ||
    body.reason.trim().length < 5 ||
    body.reason.trim().length > 500
  )
    fail(400, 'A reason of 5–500 characters is required');
  if (
    !body.changes ||
    typeof body.changes !== 'object' ||
    Array.isArray(body.changes) ||
    !Object.keys(body.changes).length ||
    Object.keys(body.changes).some((key) => !USER_EDIT_FIELDS.includes(key))
  )
    fail(400, 'Only explicitly permitted preference fields may be edited');
  const changes = { ...body.changes };
  if ('displayName' in changes) {
    if (
      changes.displayName !== null &&
      (typeof changes.displayName !== 'string' ||
        changes.displayName.trim().length > 100 ||
        Array.from(changes.displayName).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ))
    )
      fail(
        400,
        'Display name must be at most 100 characters without control characters'
      );
    changes.displayName = changes.displayName?.trim() || null;
  }
  if ('preferredLanguage' in changes) {
    if (
      typeof changes.preferredLanguage !== 'string' ||
      changes.preferredLanguage.length > 35
    )
      fail(400, 'Invalid preferred language');
    try {
      changes.preferredLanguage = Intl.getCanonicalLocales(
        changes.preferredLanguage.trim()
      )[0];
    } catch {
      fail(400, 'Use a valid language tag such as en or es');
    }
    if (!changes.preferredLanguage) fail(400, 'Preferred language is required');
  }
  for (const field of ['showReadReceipts', 'showOriginalWithTranslation'])
    if (field in changes && typeof changes[field] !== 'boolean')
      fail(400, 'Preference flags must be true or false');
  return changes;
}
export async function editUserDetails(
  db,
  { actorUserId, authentication, targetUserId, body }
) {
  if (!validUserId(actorUserId) || !validUserId(targetUserId))
    fail(400, 'Invalid user ID');
  const changes = changesFrom(body);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(73421,1)::text`;
      for (const id of [...new Set([actorUserId, targetUserId])].sort(
        (a, b) => a - b
      ))
        await tx.$queryRaw`SELECT id FROM public."User" WHERE id=${id} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: actorUserId } });
      if (
        !actor ||
        actor.isBanned ||
        actor.deletedAt ||
        !hasVerifiedAdminAccess({ user: actor, auth: authentication }) ||
        actor.tokenVersion !== authentication?.tokenVersion
      )
        fail(403, 'Current MFA-verified administrator access required');
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: SELECT,
      });
      if (!target || target.deletedAt) fail(404, 'User unavailable');
      if (protectedIdentity(target))
        fail(403, 'Protected identities cannot be edited here');
      if (versionOf(target) !== body.version)
        fail(409, 'User values changed. Reload current values before saving');
      const changed = Object.keys(changes).filter(
        (field) => changes[field] !== target[field]
      );
      if (!changed.length) return { ...details(target, true), changed: false };
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: Object.fromEntries(
          changed.map((field) => [field, changes[field]])
        ),
        select: SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          action: 'ADMIN_USER_PREFERENCES_UPDATED',
          resource: 'user',
          resourceId: String(targetUserId),
          status: 200,
          metadata: { fields: changed, reason: body.reason.trim() },
        },
      });
      return { ...details(updated, true), changed: true };
    },
    { isolationLevel: 'Serializable' }
  );
}
