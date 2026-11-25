import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(['apns', 'apns_voip', 'fcm']);
const APNS_ENVIRONMENTS = new Set(['production', 'sandbox']);

export class PushAuthorityError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => {
  if (!a || !b) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

function installationInput({ installationId, installationProof }) {
  if (typeof installationId !== 'string' || !UUID.test(installationId)) {
    throw new PushAuthorityError('INVALID_INSTALLATION', 400);
  }
  if (typeof installationProof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(installationProof)) {
    throw new PushAuthorityError('INVALID_INSTALLATION_PROOF', 400);
  }
  const proof = Buffer.from(installationProof, 'base64url');
  if (proof.length !== 32 || proof.toString('base64url') !== installationProof) {
    throw new PushAuthorityError('INVALID_INSTALLATION_PROOF', 400);
  }
  return { installationId: installationId.toLowerCase(), proof };
}

function verifiedSession(auth, now = Date.now()) {
  if (!auth?.pushFingerprint || !Number.isSafeInteger(auth.pushIssuedAtMs) ||
      !Number.isSafeInteger(auth.pushExpiresAtMs) || auth.pushIssuedAtMs <= 0 ||
      auth.pushExpiresAtMs <= now || !Number.isSafeInteger(auth.tokenVersion)) {
    throw new PushAuthorityError('PUSH_SESSION_UNAVAILABLE', 401);
  }
  return auth;
}

function cleanupCapability(proof, fingerprint, generation) {
  return crypto.createHmac('sha256', proof)
    .update(`chatforia-push-cleanup:v1:${fingerprint}:${generation}`)
    .digest('base64url');
}

async function assertCurrentSession(tx, userId, session) {
  const account = await tx.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true, isBanned: true, deletedAt: true },
  });
  if (!account || account.isBanned || account.deletedAt ||
      account.tokenVersion !== session.tokenVersion || session.pushExpiresAtMs <= Date.now()) {
    throw new PushAuthorityError('PUSH_SESSION_REVOKED', 401);
  }
}

async function withSerializableRetry(operation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      if ((error?.code === 'P2034' || error?.code === 'P2002') && attempt < 2) continue;
      throw error;
    }
  }
  throw new PushAuthorityError('PUSH_AUTHORITY_BUSY', 503);
}

async function lockInstallation(tx, installationId) {
  await tx.$queryRaw`SELECT "id" FROM public."PushInstallation" WHERE "id" = ${installationId}::uuid FOR UPDATE`;
  return tx.pushInstallation.findUnique({ where: { id: installationId } });
}

async function lockSessionAuthority(tx, fingerprint) {
  // Serialize logout with activation/registration even when no grant exists.
  const key = BigInt.asIntN(64, BigInt(`0x${fingerprint.slice(0, 16)}`));
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text`;
  if (await tx.pushSessionRevocation.findUnique({ where: { sessionFingerprint: fingerprint } })) {
    throw new PushAuthorityError('PUSH_SESSION_REVOKED', 403);
  }
}

// Session-issuing account operations must share the logout fence. A revoked
// full JWT must never mint a fresh, independently push-eligible JWT.
export async function assertUnrevokedFullSession(tx, auth) {
  const session = verifiedSession(auth);
  await lockSessionAuthority(tx, session.pushFingerprint);
}

async function lockSessionForRevocation(tx, fingerprint) {
  const key = BigInt.asIntN(64, BigInt(`0x${fingerprint.slice(0, 16)}`));
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text`;
}

function fieldFor(provider, environment) {
  if (provider === 'apns') return environment === 'sandbox' ? 'apnsSandboxPushToken' : 'apnsPushToken';
  if (provider === 'apns_voip') return environment === 'sandbox' ? 'voipSandboxPushToken' : 'voipPushToken';
  return 'fcmPushToken';
}

async function clearMirror(tx, deviceRowId, registration) {
  if (!deviceRowId || !registration?.token) return;
  const field = fieldFor(registration.provider, registration.environment);
  await tx.device.updateMany({
    where: { id: deviceRowId, [field]: registration.token },
    data: { [field]: null },
  });
  if (registration.provider !== 'apns_voip') {
    await tx.device.updateMany({
      where: { id: deviceRowId, pushToken: registration.token },
      data: { pushToken: null, pushProvider: null },
    });
  }
}

export async function activatePushInstallation({ user, auth, body }) {
  const { installationId, proof } = installationInput(body);
  const session = verifiedSession(auth);
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  const platform = body?.platform;
  const appId = body?.appId;
  if (!deviceId || deviceId.length > 191 || !['ios', 'android'].includes(platform) ||
      typeof appId !== 'string' || !/^[a-zA-Z0-9.-]{3,160}$/.test(appId)) {
    throw new PushAuthorityError('INVALID_DEVICE', 400);
  }
  const userId = Number(user.id);
  const now = new Date();
  const proofHash = digest(proof);

  return withSerializableRetry(async (tx) => {
    await lockSessionAuthority(tx, session.pushFingerprint);
    await assertCurrentSession(tx, userId, session);
    const device = await tx.device.findUnique({ where: { userId_deviceId: { userId, deviceId } } });
    if (!device || device.revokedAt || String(device.pairingStatus || '').toLowerCase() === 'rejected') {
      throw new PushAuthorityError('DEVICE_NOT_ELIGIBLE', 403);
    }
    // Serialize all installation activations and logout for this Device row.
    // A new installation identity must retire an older session on the same
    // device, while other independently registered devices stay available.
    await tx.$queryRaw`SELECT "id" FROM public."Device" WHERE "id" = ${device.id} FOR UPDATE`;
    const otherAuthorities = await tx.pushInstallation.findMany({
      where: { currentDeviceRowId: device.id, id: { not: installationId }, revokedAt: null },
      orderBy: { id: 'asc' },
    });
    for (const other of otherAuthorities) {
      const locked = await lockInstallation(tx, other.id);
      if (locked?.revokedAt) continue;
      if (locked.sessionFingerprint !== session.pushFingerprint &&
          BigInt(session.pushIssuedAtMs) <= locked.highWaterIssuedAtMs) {
        throw new PushAuthorityError('STALE_PUSH_SESSION', 409);
      }
      await revokeAuthority(tx, locked);
    }
    let current = await lockInstallation(tx, installationId);
    if (current && (!safeEqual(current.proofHash, proofHash) ||
        current.platform !== platform || current.appId !== appId)) {
      throw new PushAuthorityError('INSTALLATION_OWNERSHIP_MISMATCH', 403);
    }
    if (current && current.sessionFingerprint !== session.pushFingerprint &&
        BigInt(session.pushIssuedAtMs) <= current.highWaterIssuedAtMs) {
      throw new PushAuthorityError('STALE_PUSH_SESSION', 409);
    }
    const sameSession = current?.sessionFingerprint === session.pushFingerprint &&
      current.currentUserId === userId && current.currentDeviceRowId === device.id &&
      current.revokedAt == null && current.sessionExpiresAt > now;
    if (!sameSession) {
      const generation = (current?.generation ?? 0n) + 1n;
      if (current) {
        const oldRegistrations = await tx.pushRegistration.findMany({
          where: { installationId, revokedAt: null },
        });
        // A renewed session for the same account/device may retain its tokens.
        if (current.currentUserId === userId && current.currentDeviceRowId === device.id && !current.revokedAt) {
          await tx.pushRegistration.updateMany({
            where: { installationId, revokedAt: null }, data: { generation },
          });
        } else {
          for (const registration of oldRegistrations) {
            await clearMirror(tx, current.currentDeviceRowId, registration);
          }
          await tx.pushRegistration.updateMany({
            where: { installationId, revokedAt: null }, data: { revokedAt: now, token: null },
          });
        }
        current = await tx.pushInstallation.update({
          where: { id: installationId },
          data: {
            generation, currentUserId: userId, currentDeviceRowId: device.id,
            sessionFingerprint: session.pushFingerprint, tokenVersion: session.tokenVersion,
            issuedAtMs: BigInt(session.pushIssuedAtMs),
            highWaterIssuedAtMs: BigInt(session.pushIssuedAtMs),
            sessionExpiresAt: new Date(session.pushExpiresAtMs), revokedAt: null,
            cleanupHash: digest(cleanupCapability(proof, session.pushFingerprint, generation)),
          },
        });
      } else {
        current = await tx.pushInstallation.create({
          data: {
            id: installationId, proofHash, platform, appId, generation,
            currentUserId: userId, currentDeviceRowId: device.id,
            sessionFingerprint: session.pushFingerprint, tokenVersion: session.tokenVersion,
            issuedAtMs: BigInt(session.pushIssuedAtMs),
            highWaterIssuedAtMs: BigInt(session.pushIssuedAtMs),
            sessionExpiresAt: new Date(session.pushExpiresAtMs),
            cleanupHash: digest(cleanupCapability(proof, session.pushFingerprint, generation)),
          },
        });
      }
    }
    return {
      generation: current.generation.toString(),
      expiresAt: current.sessionExpiresAt.toISOString(),
      cleanupCapability: cleanupCapability(proof, session.pushFingerprint, current.generation),
    };
  });
}

export async function registerAuthorizedPush({ user, auth, body }) {
  const { installationId, proof } = installationInput(body);
  const session = verifiedSession(auth);
  const provider = String(body?.provider || '').toLowerCase();
  const environment = String(body?.environment || '').toLowerCase();
  const token = body?.token;
  const generation = Number(body?.generation);
  const revision = Number(body?.tokenRevision);
  if (!PROVIDERS.has(provider) ||
      (provider === 'fcm' ? environment !== 'none' : !APNS_ENVIRONMENTS.has(environment)) ||
      typeof token !== 'string' || !token.trim() || token.length > 4096 ||
      !Number.isSafeInteger(generation) || generation < 1 ||
      !Number.isSafeInteger(revision) || revision < 0) {
    throw new PushAuthorityError('INVALID_PUSH_REGISTRATION', 400);
  }
  const tokenDigest = digest(token);
  const now = new Date();
  return withSerializableRetry(async (tx) => {
    await lockSessionAuthority(tx, session.pushFingerprint);
    await assertCurrentSession(tx, Number(user.id), session);
    const installation = await lockInstallation(tx, installationId);
    if (!installation || !safeEqual(installation.proofHash, digest(proof)) ||
        installation.generation !== BigInt(generation) ||
        installation.sessionFingerprint !== session.pushFingerprint ||
        installation.currentUserId !== Number(user.id) ||
        installation.tokenVersion !== session.tokenVersion ||
        installation.sessionExpiresAt <= now || installation.revokedAt) {
      throw new PushAuthorityError('PUSH_AUTHORITY_REVOKED', 403);
    }
    if ((installation.platform === 'ios' && provider === 'fcm') ||
        (installation.platform === 'android' && provider !== 'fcm')) {
      throw new PushAuthorityError('PROVIDER_PLATFORM_MISMATCH', 400);
    }
    const device = await tx.device.findUnique({ where: { id: installation.currentDeviceRowId } });
    if (!device || device.userId !== Number(user.id) || device.revokedAt ||
        String(device.pairingStatus || '').toLowerCase() === 'rejected') {
      throw new PushAuthorityError('DEVICE_NOT_ELIGIBLE', 403);
    }
    const previous = await tx.pushRegistration.findFirst({
      where: { installationId, provider, revokedAt: null },
    });
    if (previous && (BigInt(revision) < previous.tokenRevision ||
        (BigInt(revision) === previous.tokenRevision &&
          (previous.tokenDigest !== tokenDigest || previous.environment !== environment)))) {
      throw new PushAuthorityError('STALE_PUSH_TOKEN', 409);
    }
    if (previous?.tokenDigest === tokenDigest && previous.environment === environment &&
        previous.tokenRevision === BigInt(revision)) return { registered: true, generation };

    const otherOwners = await tx.pushRegistration.findMany({
      where: { provider, environment, tokenDigest, revokedAt: null,
        installationId: { not: installationId } },
    });
    for (const owner of otherOwners) {
      const oldInstallation = await lockInstallation(tx, owner.installationId);
      if (oldInstallation && !oldInstallation.revokedAt) {
        // The token represents one app installation. Moving it to a newer
        // authenticated installation must fence the previous generation,
        // including any delayed request still carrying the old session.
        if (BigInt(session.pushIssuedAtMs) <= oldInstallation.highWaterIssuedAtMs) {
          throw new PushAuthorityError('STALE_PUSH_SESSION', 409);
        }
        await revokeAuthority(tx, oldInstallation);
      }
    }
    await tx.pushRegistration.updateMany({
      where: { provider, environment, tokenDigest, revokedAt: null,
        installationId: { not: installationId } },
      data: { revokedAt: now, token: null },
    });
    if (previous) await clearMirror(tx, device.id, previous);
    if (previous) {
      await tx.pushRegistration.update({
        where: { id: previous.id },
        data: { environment, token, tokenDigest, tokenRevision: BigInt(revision), generation: installation.generation },
      });
    } else {
      await tx.pushRegistration.create({
        data: { installationId, generation: installation.generation, provider,
          environment, token, tokenDigest, tokenRevision: BigInt(revision) },
      });
    }
    const field = fieldFor(provider, environment);
    // Legacy Device rows can still own this token without a new registration.
    // Transfer their mirror atomically so the existing unique indexes cannot
    // reject a legitimate app-installation handoff.
    await tx.device.updateMany({
      where: { id: { not: device.id }, [field]: token },
      data: { [field]: null },
    });
    if (provider !== 'apns_voip') {
      await tx.device.updateMany({
        where: { id: { not: device.id }, pushToken: token },
        data: { pushToken: null, pushProvider: null },
      });
    }
    await tx.device.update({
      where: { id: device.id },
      data: { [field]: token,
        ...(provider !== 'apns_voip' ? { pushToken: token, pushProvider: provider } : {}) },
    });
    return { registered: true, generation };
  });
}

export async function cleanupPushInstallation(body) {
  const installationId = body?.installationId;
  const generation = Number(body?.generation);
  const capability = body?.cleanupCapability;
  if (typeof installationId !== 'string' || !UUID.test(installationId) ||
      !Number.isSafeInteger(generation) || generation < 1 ||
      typeof capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(capability)) {
    throw new PushAuthorityError('INVALID_CLEANUP_REQUEST', 400);
  }
  await withSerializableRetry(async (tx) => {
    const installation = await lockInstallation(tx, installationId.toLowerCase());
    // Do not reveal account or installation existence to an unauthenticated caller.
    if (!installation || installation.generation !== BigInt(generation)) return;
    if (!safeEqual(installation.cleanupHash, digest(capability))) {
      throw new PushAuthorityError('INVALID_CLEANUP_CAPABILITY', 403);
    }
    await revokeAuthority(tx, installation);
  });
}

async function revokeAuthority(tx, installation) {
  const registrations = await tx.pushRegistration.findMany({
    where: { installationId: installation.id, revokedAt: null },
  });
  for (const registration of registrations) {
    await clearMirror(tx, installation.currentDeviceRowId, registration);
  }
  const now = new Date();
  await tx.pushRegistration.updateMany({
    where: { installationId: installation.id, revokedAt: null },
    data: { revokedAt: now, token: null },
  });
  await tx.pushInstallation.update({
    where: { id: installation.id },
    data: { generation: { increment: 1 }, currentUserId: null,
      currentDeviceRowId: null, sessionFingerprint: null, tokenVersion: null,
      issuedAtMs: null, sessionExpiresAt: null, cleanupHash: null, revokedAt: now },
  });
}

// A verified signed session is a revocation capability for its own push
// grants, including after JWT expiry. Never persist or log the raw token.
async function revokeSessionWithinTransaction(tx, session) {
  const { fingerprint, expiresAt } = session;
  if (expiresAt > new Date()) {
    await tx.pushSessionRevocation.upsert({
      where: { sessionFingerprint: fingerprint },
      create: { sessionFingerprint: fingerprint, expiresAt },
      update: {},
    });
  }
  const authorities = await tx.pushInstallation.findMany({
    where: { sessionFingerprint: fingerprint, revokedAt: null },
    orderBy: { id: 'asc' },
  });
  for (const item of authorities) {
    const locked = await lockInstallation(tx, item.id);
    if (locked?.sessionFingerprint === fingerprint && !locked.revokedAt) {
      await revokeAuthority(tx, locked);
    }
  }
}

export async function revokePushAuthorityForSession(session) {
  if (!session) return;
  await withSerializableRetry(async (tx) => {
    await lockSessionForRevocation(tx, session.fingerprint);
    await revokeSessionWithinTransaction(tx, session);
  });
}

export async function revokeAuthenticatedDevice({ user, auth, deviceId }) {
  const userId = Number(user?.id);
  if (!userId || !deviceId) throw new PushAuthorityError('DEVICE_ID_REQUIRED', 400);
  return withSerializableRetry(async (tx) => {
    const session = auth?.pushFingerprint && Number.isSafeInteger(auth.pushExpiresAtMs)
      ? { fingerprint: auth.pushFingerprint, expiresAt: new Date(auth.pushExpiresAtMs) }
      : null;
    if (session) await lockSessionForRevocation(tx, session.fingerprint);
    const device = await tx.device.findUnique({ where: { userId_deviceId: { userId, deviceId } } });
    if (!device || device.revokedAt) throw new PushAuthorityError('DEVICE_NOT_FOUND', 404);
    await tx.$queryRaw`SELECT "id" FROM public."Device" WHERE "id" = ${device.id} FOR UPDATE`;
    const authorities = await tx.pushInstallation.findMany({
      where: { currentDeviceRowId: device.id, currentUserId: userId, revokedAt: null },
      orderBy: { id: 'asc' },
    });
    const lockedAuthorities = [];
    for (const item of authorities) lockedAuthorities.push(await lockInstallation(tx, item.id));
    if (lockedAuthorities.some((item) => item?.sessionFingerprint !== auth?.pushFingerprint)) {
      // A delayed logout from an older session cannot clear a newer session.
      if (session) await revokeSessionWithinTransaction(tx, session);
      return { success: true, stale: true };
    }
    if (session) await revokeSessionWithinTransaction(tx, session);
    else for (const locked of lockedAuthorities) await revokeAuthority(tx, locked);
    await tx.device.update({
      where: { id: device.id },
      data: {
        pushToken: null, pushProvider: null, apnsPushToken: null,
        apnsSandboxPushToken: null, fcmPushToken: null, voipPushToken: null,
        voipSandboxPushToken: null, voiceIdentity: null, voiceRegisteredAt: null,
        voiceRegistrationVer: 0, voicePushEnvironment: null, lastSeenAt: new Date(),
      },
    });
    return { success: true, stale: false };
  });
}

export function pushAuthorityMode() {
  return process.env.PUSH_AUTHORITY_MODE === 'strict' ? 'strict' : 'shadow';
}

export async function revokeInvalidProviderToken(provider, environment, token) {
  if (!PROVIDERS.has(provider) || !token) return;
  await prisma.pushRegistration.updateMany({
    where: { provider, environment, tokenDigest: digest(token), revokedAt: null },
    data: { revokedAt: new Date(), token: null },
  });
}

export async function authorizedPushRegistrations(userId, provider = null) {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { tokenVersion: true, isBanned: true, deletedAt: true },
  });
  if (!user || user.isBanned || user.deletedAt) return [];
  const rows = await prisma.pushRegistration.findMany({
    where: {
      revokedAt: null, token: { not: null },
      ...(provider ? { provider } : {}),
      installation: { currentUserId: Number(userId), revokedAt: null,
        sessionExpiresAt: { gt: now } },
    },
    include: { installation: { include: { currentDevice: true } } },
  });
  return rows.filter((row) => {
    const authority = row.installation;
    const device = authority.currentDevice;
    return row.generation === authority.generation &&
      authority.tokenVersion === user.tokenVersion &&
      Boolean(authority.sessionFingerprint) &&
      device?.userId === Number(userId) && !device.revokedAt &&
      String(device.pairingStatus || '').toLowerCase() !== 'rejected' &&
      digest(row.token) === row.tokenDigest;
  });
}
