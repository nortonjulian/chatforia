import 'dotenv/config';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import AppleStrategy from 'passport-apple';
import * as fs from 'node:fs';

// ---------- GOOGLE ----------
const HAS_GOOGLE = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// small mask for logs
const mask = (v) => (v ? `${String(v).slice(0,4)}…(${String(v).length})` : null);
console.log('[oauth:passport] env', {
  GOOGLE_CLIENT_ID: mask(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: mask(process.env.GOOGLE_CLIENT_SECRET),
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || null,
});

// replace with your real DB upsert
async function upsertUserFromGoogle(profile) {
  const email = profile.emails?.[0]?.value || null;
  return {
    id: `google:${profile.id}`, // ✅ keep string
    provider: 'google',
    email,
    name: profile.displayName,
    avatarUrl: profile.photos?.[0]?.value || null,
  };
}

if (HAS_GOOGLE) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:
          process.env.GOOGLE_CALLBACK_URL ||
          'http://localhost:5002/auth/google/callback',
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
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
    // convert \n escapes back to newlines
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
          clientID: process.env.APPLE_SERVICE_ID, // e.g. com.chatforia.auth
          teamID: process.env.APPLE_TEAM_ID,
          keyID: process.env.APPLE_KEY_ID,
          privateKey,
          callbackURL: process.env.APPLE_CALLBACK_URL,
          scope: ['name', 'email'],
          passReqToCallback: true,
        },
        async (req, accessToken, refreshToken, idToken, profile, done) => {
          try {
            // Stable Apple user id (per app)
            const sub = idToken?.sub || profile?.id;
            if (!sub) throw new Error('Apple sub missing');

            const email = idToken?.email || profile?.email || null;

            // Apple often returns email/name ONLY on first login
            const user = {
              id: `apple:${sub}`, // ✅ keep string
              provider: 'apple',
              email,
              name: profile?.name?.givenName
                ? `${profile.name.givenName} ${profile.name.familyName || ''}`.trim()
                : null,
              avatarUrl: null,
            };

            // TODO: replace with real DB upsert/lookup by provider+sub
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
