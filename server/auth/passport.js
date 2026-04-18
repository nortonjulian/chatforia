import 'dotenv/config';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { resolveOAuthUser } from '../services/oauthIdentity.js';

// ---------- GOOGLE ----------
const HAS_GOOGLE = !!(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

const mask = (v) => (v ? `${String(v).slice(0, 4)}…(${String(v).length})` : null);
console.log('[oauth:passport] env', {
  GOOGLE_CLIENT_ID: mask(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: mask(process.env.GOOGLE_CLIENT_SECRET),
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || null,
});

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
      async (req, _accessToken, _refreshToken, profile, done) => {
        try {
          const googleSub = profile?.id;
          if (!googleSub) {
            throw new Error('Google profile id missing');
          }

          const email = profile.emails?.[0]?.value?.trim().toLowerCase() || null;
          const displayName = profile.displayName?.trim() || null;
          const avatarUrl = profile.photos?.[0]?.value || null;

          const user = await resolveOAuthUser({
            provider: 'google',
            providerSub: googleSub,
            email,
            emailVerified: !!email,
            displayName,
            avatarUrl,
            logContext: {
              channel: 'web-passport',
              path: req?.originalUrl || null,
            },
          });

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

export default passport;