import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { issueSession } from './auth.js';
import { createMfaChallenge } from '../services/mfaLogin.js';
import { verifyAppleIdToken } from '../services/appleTokenVerifier.js';
import { resolveOAuthUser } from '../services/oauthIdentity.js';

const router = Router();

const googleClient = new OAuth2Client();

const googleAudiences = [
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_WEB_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
].filter(Boolean);

const appleAudience =
  process.env.APPLE_IOS_BUNDLE_ID ||
  process.env.APPLE_BUNDLE_ID ||
  process.env.IOS_BUNDLE_ID ||
  process.env.APPLE_CLIENT_ID;

// POST /auth/oauth/google/ios
async function handleGoogleOAuth(req, res, channel = 'mobile') {
  try {
    const { idToken } = req.body || {};

    if (typeof idToken !== 'string' || !idToken.trim()) {
      return res.status(400).json({ error: 'Missing idToken' });
    }

    if (!googleAudiences.length) {
      return res.status(503).json({ error: 'Google OAuth not configured' });
    }

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: googleAudiences,
      });
    } catch {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const payload = ticket.getPayload();

    const googleSub = payload?.sub;
    const email = payload?.email ?? null;
    const name = payload?.name ?? null;
    const avatar = payload?.picture ?? null;

    if (!googleSub) {
      return res.status(400).json({ error: 'Invalid Google token' });
    }

    const user = await resolveOAuthUser({
      provider: 'google',
      providerSub: googleSub,
      email,
      emailVerified: payload?.email_verified === true,
      displayName: name,
      avatarUrl: avatar,
      referralCode: req.body?.referralCode,
      referralSource: `${channel}-google`,
      logContext: {
        channel,
        path: req.originalUrl,
      },
    });

    if (user.twoFactorEnabled) {
      const mfaToken = await createMfaChallenge(user);
      return res.json({ message: 'mfa_required', mfaRequired: true, mfaToken });
    }
    const token = issueSession(res, user);

    return res.json({
      message: 'logged in',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        publicKey: user.publicKey ?? null,
        plan: user.plan ?? 'FREE',
        role: user.role ?? 'USER',
      },
    });
  } catch (err) {
    if (err?.code === 'oauth_provider_conflict') {
      return res.status(409).json({
        error: 'oauth_provider_conflict',
        message:
          'This sign-in is linked to a different Chatforia account. Please contact support.',
      });
    }

    console.error(`Google ${channel} OAuth error:`, {
      message: err?.message || String(err),
      status: err?.response?.status || null,
      code: err?.code || null,
    });

    return res.status(500).json({
      error: 'OAuth failed',
      details:
        process.env.NODE_ENV === 'production'
          ? undefined
          : err?.message || String(err),
    });
  }
}

router.post('/google/ios', (req, res) =>
  handleGoogleOAuth(req, res, 'ios')
);

router.post('/google/android', (req, res) =>
  handleGoogleOAuth(req, res, 'android')
);

// POST /auth/oauth/apple/ios
router.post('/apple/ios', async (req, res) => {
  try {
    const { identityToken, nonce, firstName, lastName } = req.body || {};

    if (!identityToken) {
      return res.status(400).json({ error: 'Missing identityToken' });
    }

    const decoded = await verifyAppleIdToken(identityToken, {
      audience: [appleAudience, 'com.chatforia.Chatforia'].filter(Boolean),
      nonce,
    });
    const appleSub = decoded.sub;
    const email = decoded.email ?? null;
    const emailVerified =
      decoded.email_verified === true || decoded.email_verified === 'true';

    const displayName =
      [firstName, lastName].filter(Boolean).join(' ').trim() || null;

    const user = await resolveOAuthUser({
      provider: 'apple',
      providerSub: appleSub,
      email,
      emailVerified,
      displayName,
      avatarUrl: null,
      referralCode: req.body?.referralCode,
      referralSource: 'ios-apple',
      logContext: {
        channel: 'ios',
        path: req.originalUrl,
      },
    });

    if (user.twoFactorEnabled) {
      const mfaToken = await createMfaChallenge(user);
      return res.json({ message: 'mfa_required', mfaRequired: true, mfaToken });
    }
    const token = issueSession(res, user);

    return res.json({
      message: 'logged in',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        publicKey: user.publicKey ?? null,
        plan: user.plan ?? 'FREE',
        role: user.role ?? 'USER',
      },
    });
  } catch (err) {
    if (err?.code === 'oauth_provider_conflict') {
      return res.status(409).json({
        error: 'oauth_provider_conflict',
        message:
          'This sign-in is linked to a different Chatforia account. Please contact support.',
      });
    }

    if (err?.code === 'invalid_apple_token') {
      return res.status(401).json({ error: 'Invalid Apple token' });
    }

    console.error('Apple iOS OAuth error:', {
      message: err?.message || String(err),
      status: err?.response?.status || null,
      code: err?.code || null,
    });

    return res.status(500).json({
      error: 'OAuth failed',
      details:
        process.env.NODE_ENV === 'production'
          ? undefined
          : err?.message || String(err),
    });
  }
});

export default router;