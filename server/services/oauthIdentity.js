import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  return value || null;
}

function sanitizeUsernameSeed(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

async function generateUniquePendingUsername(tx, { email, displayName }) {
  const emailSeed = email ? email.split('@')[0] : '';
  const displaySeed = displayName ? displayName.replace(/\s+/g, '_') : '';
  const seed = sanitizeUsernameSeed(emailSeed || displaySeed || 'chatforia') || 'chatforia';

  // 8-character prefix + 4-character seed + 8 random hex characters = 20.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `pending_${seed.slice(0, 4)}${crypto.randomBytes(4).toString('hex')}`;
    const existing = await tx.user.findFirst({
      where: {
        OR: [
          { usernameNorm: candidate.toLowerCase() },
          { username: { equals: candidate, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error('Unable to allocate a unique OAuth username');
}

function providerField(provider) {
  if (provider === 'apple') return 'appleSub';
  if (provider === 'google') return 'googleSub';
  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

function defaultEmailVerifiedAt({ email, emailVerified }) {
  if (!email) return null;
  return emailVerified ? new Date() : null;
}

export async function resolveOAuthUser({
  provider,
  providerSub,
  email,
  emailVerified = false,
  displayName = null,
  avatarUrl = null,
  logContext = {},
}) {
  if (!providerSub) {
    throw new Error(`${provider} providerSub is required`);
  }

  const subField = providerField(provider);
  const normalizedEmail = normalizeEmail(email);
  const verifiedEmail = emailVerified === true && normalizedEmail !== null;

  function conflict() {
    const err = new Error('oauth_provider_conflict');
    err.code = 'oauth_provider_conflict';
    return err;
  }

  function requireActive(user) {
    if (user.deletedAt || user.isBanned) throw conflict();
  }

  async function emailMatches(tx) {
    return tx.user.findMany({
      where: {
        OR: [
          { emailNorm: normalizedEmail },
          { email: { equals: normalizedEmail, mode: 'insensitive' } },
        ],
      },
      take: 2,
    });
  }

  return prisma.$transaction(async (tx) => {
    // 1) Canonical lookup by provider subject first
    let user = await tx.user.findFirst({
      where: { [subField]: providerSub },
    });

    if (user) {
      requireActive(user);
      // A provider can only verify the email it actually supplied.
      const attachEmail = verifiedEmail && !user.email;
      if (attachEmail) {
        const matches = await emailMatches(tx);
        if (matches.some((match) => match.id !== user.id)) throw conflict();
      }
      const verifyStoredEmail = verifiedEmail &&
        (attachEmail || normalizeEmail(user.email) === normalizedEmail);
      const updateData = {
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(displayName && !user.displayName ? { displayName } : {}),
        ...(attachEmail ? { email: normalizedEmail, emailNorm: normalizedEmail } : {}),
        ...(verifyStoredEmail
          ? { emailVerifiedAt: user.emailVerifiedAt ?? new Date() }
          : {}),
      };

      if (Object.keys(updateData).length > 0) {
        user = await tx.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }

      console.info('[oauth.resolve] matched by providerSub', {
        provider,
        providerSub,
        normalizedEmail,
        userId: user.id,
        ...logContext,
      });

      return user;
    }

    // 2) Email linking requires one unambiguous, provider-verified match.
    if (normalizedEmail) {
      const matches = await emailMatches(tx);
      if (matches.length > 1) throw conflict();
      const emailUser = matches[0];

      if (emailUser) {
        requireActive(emailUser);
        if (!verifiedEmail) throw conflict();
        if (emailUser[subField] && emailUser[subField] !== providerSub) {
          throw conflict();
        }
        // Hard conflict guard:
        // if some *other* row already owns this providerSub, do not silently continue.
        const providerOwner = await tx.user.findFirst({
          where: { [subField]: providerSub },
          select: { id: true, email: true, username: true },
        });

        if (providerOwner && providerOwner.id !== emailUser.id) {
          const err = new Error('oauth_provider_conflict');
          err.code = 'oauth_provider_conflict';
          err.meta = {
            provider,
            providerSub,
            providerOwnerId: providerOwner.id,
            emailUserId: emailUser.id,
          };
          throw err;
        }

        // Claim an empty provider slot atomically so concurrent links cannot overwrite it.
        const claimed = await tx.user.updateMany({
          where: {
            id: emailUser.id,
            deletedAt: null,
            isBanned: false,
            OR: [{ [subField]: null }, { [subField]: providerSub }],
          },
          data: { [subField]: providerSub },
        });
        if (claimed.count !== 1) throw conflict();

        const updateData = {
          emailNorm: normalizedEmail,
          ...(displayName && !emailUser.displayName ? { displayName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
          emailVerifiedAt: emailUser.emailVerifiedAt ?? new Date(),
        };

        user = await tx.user.update({
          where: { id: emailUser.id },
          data: updateData,
        });

        console.info('[oauth.resolve] matched by email and linked provider', {
          provider,
          providerSub,
          normalizedEmail,
          userId: user.id,
          ...logContext,
        });

        return user;
      }
    }

    // 3) Otherwise create a new user
    const username = await generateUniquePendingUsername(tx, {
      email: normalizedEmail,
      displayName,
    });

    user = await tx.user.create({
      data: {
        username,
        usernameNorm: username.toLowerCase(),
        email: normalizedEmail,
        emailNorm: normalizedEmail,
        displayName,
        avatarUrl,
        [subField]: providerSub,
        passwordHash: 'oauth',
        emailVerifiedAt: defaultEmailVerifiedAt({
          email: normalizedEmail,
          emailVerified,
        }),
        role: 'USER',
        plan: 'FREE',
      },
    });


    console.info('[oauth.resolve] created new oauth user', {
      provider,
      providerSub,
      normalizedEmail,
      userId: user.id,
      ...logContext,
    });

    return user;
  });
}
