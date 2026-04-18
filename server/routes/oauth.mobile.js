import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { issueSession } from './auth.js';
import jwt from 'jsonwebtoken';
import { resolveOAuthUser } from '../services/oauthIdentity.js';

const router = Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const appleAudience =
  process.env.APPLE_IOS_BUNDLE_ID ||
  process.env.APPLE_BUNDLE_ID ||
  process.env.IOS_BUNDLE_ID ||
  process.env.APPLE_CLIENT_ID;

// POST /auth/oauth/google/ios
router.post('/google/ios', async (req, res) => {
  try {
    const { idToken } = req.body || {};

    if (!idToken) {
      return res.status(400).json({ error: 'Missing idToken' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

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
      emailVerified: !!email,
      displayName: name,
      avatarUrl: avatar,
      logContext: {
        channel: 'ios',
        path: req.originalUrl,
      },
    });

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

    console.error('Google iOS OAuth error:', err);
    return res.status(500).json({
      error: 'OAuth failed',
      details: err?.message || String(err),
    });
  }
});

// POST /auth/oauth/apple/ios
router.post('/apple/ios', async (req, res) => {
  try {
    const { identityToken, nonce, firstName, lastName } = req.body || {};

    if (!identityToken) {
      return res.status(400).json({ error: 'Missing identityToken' });
    }

    const decoded = jwt.decode(identityToken);

    if (!decoded || typeof decoded !== 'object') {
      return res.status(400).json({ error: 'Invalid Apple token' });
    }

    if (decoded.iss !== 'https://appleid.apple.com') {
      return res.status(400).json({ error: 'Invalid Apple issuer' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (!decoded.exp || Number(decoded.exp) < now) {
      return res.status(400).json({ error: 'Expired Apple token' });
    }

    const appleSub = decoded.sub;
    const email = decoded.email ?? null;
    const emailVerified =
      decoded.email_verified === true || decoded.email_verified === 'true';

    if (!appleSub) {
      return res.status(400).json({ error: 'Invalid Apple token: missing sub' });
    }

    if (appleAudience && decoded.aud !== appleAudience) {
      return res.status(400).json({ error: 'Invalid Apple token audience' });
    }

    console.info('[oauth.apple.ios] decoded token', {
      hasNonce: !!nonce,
      tokenNonce: decoded.nonce || null,
      aud: decoded.aud || null,
      sub: appleSub,
      email,
    });

    const displayName =
      [firstName, lastName].filter(Boolean).join(' ').trim() || null;

    const user = await resolveOAuthUser({
      provider: 'apple',
      providerSub: appleSub,
      email,
      emailVerified,
      displayName,
      avatarUrl: null,
      logContext: {
        channel: 'ios',
        path: req.originalUrl,
      },
    });

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

    console.error('Apple iOS OAuth error:', err);
    return res.status(500).json({
      error: 'OAuth failed',
      details: err?.message || String(err),
    });
  }
});

export default router;