import express from "express";
import { Router } from "express";
import passport from "../auth/passport.js";
import { issueSession } from "./auth.js";
import { startWebMfa } from "../services/webMfa.js";
import axios from "axios";
import fs from "node:fs";
import jwtLib from "jsonwebtoken";
import { resolveOAuthUser } from "../services/oauthIdentity.js";
import { verifyAppleIdToken } from "../services/appleTokenVerifier.js";
import { webOAuthState } from "../services/webOAuthState.js";

const router = Router();
const FRONTEND =
  process.env.FRONTEND_URL ||
  process.env.FRONTEND_ORIGIN ||
  "http://localhost:5173";

/* ---------- helpers ---------- */
function getSafeNextUrl(raw, allowAppleApp = false) {
  if (typeof raw !== 'string' || !raw) return FRONTEND;

  try {
    const parsed = new URL(raw);
    if (allowAppleApp && parsed.protocol === 'chatforia:' &&
        parsed.hostname === 'oauth' && parsed.pathname === '/apple' &&
        !parsed.username && !parsed.password && !parsed.port) return parsed.toString();
    const allowed = new Set([
      new URL(FRONTEND).origin,
      "https://www.chatforia.com",
      "https://chatforia.com",
      "http://localhost:5173",
    ]);
    return allowed.has(parsed.origin) ? raw : FRONTEND;
  } catch {
    return FRONTEND;
  }
}

function readApplePrivateKey() {
  return fs.readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, "utf8").trim();
}

function buildAppleClientSecret() {
  const now = Math.floor(Date.now() / 1000);

  return jwtLib.sign(
    {
      iss: process.env.APPLE_TEAM_ID,
      iat: now,
      exp: now + 60 * 60,
      aud: "https://appleid.apple.com",
      sub: process.env.APPLE_CLIENT_ID,
    },
    readApplePrivateKey(),
    {
      algorithm: "ES256",
      keyid: process.env.APPLE_KEY_ID,
    }
  );
}

async function exchangeAppleCodeForTokens(code) {
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    client_secret: buildAppleClientSecret(),
    code,
    grant_type: "authorization_code",
    redirect_uri: process.env.APPLE_CALLBACK_URL,
  });

  const { data } = await axios.post(
    "https://appleid.apple.com/auth/token",
    params.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    }
  );

  return data;
}

async function handleAppleCallback(req, res) {
  try {
    const source = req.method === "GET" ? req.query : req.body;
    const { code, user: rawUser } = source || {};

    if (!code) {
      return res.status(400).json({ error: "Missing Apple authorization code" });
    }

    const tokenResponse = await exchangeAppleCodeForTokens(code);
    const claims = await verifyAppleIdToken(tokenResponse.id_token, {
      audience: process.env.APPLE_CLIENT_ID,
      nonce: req.oauthFlow.nonce,
    });

    let firstName = null;
    let lastName = null;

    if (rawUser) {
      try {
        const parsedUser =
          typeof rawUser === "string" ? JSON.parse(rawUser) : rawUser;
        firstName = parsedUser?.name?.firstName || null;
        lastName = parsedUser?.name?.lastName || null;
      } catch {}
    }

    let appUser;

    try {
      appUser = await resolveOAuthUser({
        provider: "apple",
        providerSub: claims.sub,
        email: claims.email || null,
        emailVerified:
          claims.email_verified === true || claims.email_verified === "true",
        displayName:
          [firstName, lastName].filter(Boolean).join(" ").trim() || null,
        avatarUrl: null,
        referralCode: req.oauthFlow.referralCode,
        referralSource: 'web-apple',
        logContext: {
          channel: "web",
          path: req.originalUrl,
        },
      });
    } catch (err) {
      if (err?.code === "oauth_provider_conflict") {
        return res.status(409).json({
          error: "oauth_provider_conflict",
          message: "This Apple account is linked to a different Chatforia account.",
        });
      }
      throw err;
    }

    const nextUrl = getSafeNextUrl(req.oauthFlow.next, true);
    if (appUser.twoFactorEnabled) return await startWebMfa(req, res, appUser, nextUrl);
    const token = issueSession(res, appUser);

    if (nextUrl.startsWith("chatforia://oauth/apple")) {
      const redirectUrl = new URL(nextUrl);
      redirectUrl.searchParams.set("token", token);
      return res.redirect(redirectUrl.toString());
    }

    return res.redirect(nextUrl);
  } catch (e) {
    if (e?.code === 'invalid_apple_token') {
      return res.status(401).json({ error: 'Invalid Apple token' });
    }

    console.error("[APPLE MANUAL CALLBACK ERROR]", {
      message: e?.message,
      status: e?.response?.status,
      bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : [],
      queryKeys: req.query && typeof req.query === "object" ? Object.keys(req.query) : [],
    });

    return res.status(500).json({
      error: "Apple sign-in failed",
      detail: process.env.NODE_ENV === 'production'
        ? undefined
        : e?.message || "Unknown error",
    });
  }
}

function consumeWebState(provider) {
  return async (req, res, next) => {
    try {
      const source = req.method === 'GET' ? req.query : req.body;
      req.oauthFlow = await webOAuthState.consume(req, res, provider, source?.state);
      return next();
    } catch (error) {
      if (error?.code === 'invalid_oauth_state') {
        return res.status(400).json({ error: 'invalid_oauth_state' });
      }
      console.error('[oauth.state] Store unavailable', { message: error?.message });
      return res.status(503).json({ error: 'OAuth temporarily unavailable' });
    }
  };
}

/* ---------- GOOGLE ---------- */
router.get("/google", async (req, res, next) => {
  if (!passport._strategy("google")) {
    return res.status(501).json({ error: "Google OAuth not configured" });
  }

  let state;
  try {
    ({ state } = await webOAuthState.begin(req, res, {
      provider: 'google', next: getSafeNextUrl(req.query.next),
      referralCode: req.query.ref,
    }));
  } catch (error) {
    console.error('[oauth.state] Store unavailable', { message: error?.message });
    return res.status(503).json({ error: 'OAuth temporarily unavailable' });
  }

  return passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    state,
  })(req, res, next);
});

router.get(
  "/google/callback",
  (req, res, next) => {
    if (!passport._strategy("google")) {
      return res.status(501).json({ error: "Google OAuth not configured" });
    }
    next();
  },
  consumeWebState('google'),
  passport.authenticate("google", {
    failureRedirect: "/auth/failure",
    session: false,
  }),
  async (req, res, next) => {
    try {
      const user = req.user || {};
      const nextUrl = getSafeNextUrl(req.oauthFlow.next);
      if (user.twoFactorEnabled) return await startWebMfa(req, res, user, nextUrl);
      issueSession(res, user);
      return res.redirect(nextUrl);
    } catch (error) { return next(error); }
  }
);

/* ---------- APPLE ---------- */
router.get("/apple", async (req, res) => {
  if (!process.env.APPLE_CLIENT_ID || !process.env.APPLE_CALLBACK_URL) {
    return res.status(501).json({ error: 'Apple OAuth not configured' });
  }
  let state, nonce;
  try {
    ({ state, nonce } = await webOAuthState.begin(req, res, {
      provider: 'apple', next: getSafeNextUrl(req.query.next, true),
      referralCode: req.query.ref,
    }));
  } catch (error) {
    console.error('[oauth.state] Store unavailable', { message: error?.message });
    return res.status(503).json({ error: 'OAuth temporarily unavailable' });
  }

  const appleUrl = new URL("https://appleid.apple.com/auth/authorize");
  appleUrl.searchParams.set("client_id", process.env.APPLE_CLIENT_ID);
  appleUrl.searchParams.set("redirect_uri", process.env.APPLE_CALLBACK_URL);
  appleUrl.searchParams.set("response_type", "code");
  appleUrl.searchParams.set("response_mode", "form_post");
  appleUrl.searchParams.set("scope", "name email");
  appleUrl.searchParams.set("state", state);
  appleUrl.searchParams.set("nonce", nonce);

  return res.redirect(appleUrl.toString());
});

router.all(
  "/apple/callback",
  express.urlencoded({ extended: false }),
  (req, res, next) => {
    if (!['GET', 'POST'].includes(req.method)) return res.sendStatus(405);
    const source = req.method === 'GET' ? req.query : req.body;
    if (!source?.code && !source?.error) {
      return res.status(400).json({ error: 'Missing Apple authorization code' });
    }
    next();
  },
  consumeWebState('apple'),
  (req, res, next) => {
    const source = req.method === 'GET' ? req.query : req.body;
    if (source?.error) return res.status(401).json({ error: 'Apple sign-in declined' });
    next();
  },
  handleAppleCallback
);

router.get("/failure", (_req, res) => res.status(401).send("SSO failed"));

router.get("/debug", (_req, res) => {
  const hasApple = !!(
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY_PATH &&
    process.env.APPLE_CALLBACK_URL
  );

  res.json({
    hasGoogle: !!passport._strategy("google"),
    hasApple,
    hasAppleEnv: hasApple,
    envSeen: {
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_CALLBACK_URL: !!process.env.GOOGLE_CALLBACK_URL,
      APPLE_CLIENT_ID: !!process.env.APPLE_CLIENT_ID,
      APPLE_SERVICE_ID: !!process.env.APPLE_SERVICE_ID,
      APPLE_TEAM_ID: !!process.env.APPLE_TEAM_ID,
      APPLE_KEY_ID: !!process.env.APPLE_KEY_ID,
      APPLE_PRIVATE_KEY_PATH: !!process.env.APPLE_PRIVATE_KEY_PATH,
      APPLE_CALLBACK_URL: !!process.env.APPLE_CALLBACK_URL,
    },
  });
});

export default router;