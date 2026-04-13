import 'dotenv/config';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import AppleStrategy from 'passport-apple';
import * as fs from 'node:fs';
import prisma from '../utils/prismaClient.js';

// ---------- GOOGLE ----------
const HAS_GOOGLE = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const mask = (v) => (v ? `${String(v).slice(0,4)}…(${String(v).length})` : null);
console.log('[oauth:passport] env', {
  GOOGLE_CLIENT_ID: mask(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: mask(process.env.GOOGLE_CLIENT_SECRET),
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || null,
});

function sanitizeUsernameSeed(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

async function generateUniqueUsername({ email, displayName }) {
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

async function upsertUserFromGoogle(profile) {
  const googleSub = profile?.id;
  if (!googleSub) throw new Error('Google profile id missing');

  const email = profile.emails?.[0]?.value?.trim().toLowerCase() || null;
  const displayName = profile.displayName?.trim() || null;
  const avatarUrl = profile.photos?.[0]?.value || null;

  let user = await prisma.user.findFirst({
    where: { googleSub },
  });

  if (!user && email) {
    user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
  }

  if (!user) {
    const username = await generateUniqueUsername({ email, displayName });

    user = await prisma.user.create({
      data: {
        username,
        email,
        displayName,
        avatarUrl,
        googleSub,
        passwordHash: 'oauth',
        emailVerifiedAt: email ? new Date() : null,
        role: 'USER',
      },
    });
  } else {
    const updateData = {
      ...(user.googleSub ? {} : { googleSub }),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(displayName && !user.displayName ? { displayName } : {}),
      ...(email && !user.email ? { email } : {}),
      ...(email ? { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } : {}),
    };

    if (Object.keys(updateData).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }
  }

  return user;
}

if (HAS_GOOGLE) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:
          process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5002/auth/google/callback',
        passReqToCallback: true,
      },
      async (_req, _accessToken, _refreshToken, profile, done) => {
        try {
          const user = await upsertUserFromGoogle(profile);
          return done(null, user);
        } catch (e) {
          return done(e);
        }
      }
    )
  );
} else {
  console.warn('[oauth] GOOGLE_* not set — Google SSO disabled');
}

// ---------- APPLE ----------
function readApplePrivateKey() {
  if (process.env.APPLE_PRIVATE_KEY) {
    return process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }
  if (process.env.APPLE_PRIVATE_KEY_PATH) {
    return fs.readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, 'utf8');
  }
  return null;
}

const HAS_APPLE =
  !!(
    process.env.APPLE_SERVICE_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    (process.env.APPLE_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY_PATH)
  );

if (HAS_APPLE) {
  const privateKey = readApplePrivateKey();

  if (!privateKey) {
    console.error('[oauth] APPLE private key missing (APPLE_PRIVATE_KEY[_PATH])');
  } else {
    passport.use(
      new AppleStrategy(
        {
          clientID: process.env.APPLE_SERVICE_ID,
          teamID: process.env.APPLE_TEAM_ID,
          keyID: process.env.APPLE_KEY_ID,
          privateKey,
          callbackURL: process.env.APPLE_CALLBACK_URL,
          scope: ['name', 'email'],
          passReqToCallback: true,
        },
        async (_req, _accessToken, _refreshToken, idToken, profile, done) => {
          try {
            const sub = idToken?.sub || profile?.id;
            if (!sub) throw new Error('Apple sub missing');

            const email = idToken?.email || profile?.email || null;
            const user = {
              id: `apple:${sub}`,
              provider: 'apple',
              email,
              name: profile?.name?.givenName
                ? `${profile.name.givenName} ${profile.name.familyName || ''}`.trim()
                : null,
              avatarUrl: null,
            };

            return done(null, user);
          } catch (e) {
            return done(e);
          }
        }
      )
    );
  }
} else {
  console.warn('[oauth] APPLE_* not set — Apple SSO disabled');
}

export default passport;