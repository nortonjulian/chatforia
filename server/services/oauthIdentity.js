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

async function generateUniquePendingUsername({ email, displayName }) {
  const emailSeed = email ? email.split('@')[0] : '';
  const displaySeed = displayName ? displayName.replace(/\s+/g, '_') : '';
  const base = sanitizeUsernameSeed(emailSeed || displaySeed || 'chatforia') || 'chatforia';

  const candidates = [
    `pending_${base}`,
    `pending_${base}${Math.floor(1000 + Math.random() * 9000)}`,
    `pending_${base}${Date.now().toString().slice(-6)}`,
  ];

  for (const candidate of candidates) {
    const existing = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  return `pending_user${Date.now()}`;
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

  return prisma.$transaction(async (tx) => {
    // 1) Canonical lookup by provider subject first
    let user = await tx.user.findFirst({
      where: { [subField]: providerSub },
    });

    if (user) {
      const updateData = {
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(displayName && !user.displayName ? { displayName } : {}),
        ...(normalizedEmail && !user.email ? { email: normalizedEmail } : {}),
        ...(normalizedEmail && emailVerified
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

    // 2) Optional safe link by email to an existing account
    if (normalizedEmail) {
      const emailUser = await tx.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
        },
      });

      if (emailUser) {
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

        const updateData = {
          [subField]: providerSub,
          ...(displayName && !emailUser.displayName ? { displayName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(emailVerified ? { emailVerifiedAt: emailUser.emailVerifiedAt ?? new Date() } : {}),
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
    const username = await generateUniquePendingUsername({
      email: normalizedEmail,
      displayName,
    });

    user = await tx.user.create({
      data: {
        username,
        email: normalizedEmail,
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