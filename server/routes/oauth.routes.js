import express from "express";
import { Router } from "express";
import jwt from "jsonwebtoken";
import passport from "../auth/passport.js";
import { setJwtCookie } from "./auth.js";
import axios from "axios";
import fs from "node:fs";
import jwtLib from "jsonwebtoken";
import { resolveOAuthUser } from "../services/oauthIdentity.js";

const router = Router();
const IS_TEST = String(process.env.NODE_ENV) === "test";
const JWT_SECRET =
  process.env.JWT_SECRET || (IS_TEST ? "test_secret" : "dev-secret");

const FRONTEND =
  process.env.FRONTEND_URL ||
  process.env.FRONTEND_ORIGIN ||
  "http://localhost:5173";

/* ---------- helpers ---------- */
function getSafeNextUrl(raw) {
  if (!raw) return FRONTEND;
  try {
    const parsed = new URL(raw);
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
  if (process.env.APPLE_PRIVATE_KEY) {
    return process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (process.env.APPLE_PRIVATE_KEY_PATH) {
    return fs.readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, "utf8");
  }
  throw new Error("Missing APPLE_PRIVATE_KEY / APPLE_PRIVATE_KEY_PATH");
}

function buildAppleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  return jwtLib.sign(
    {
      iss: process.env.APPLE_TEAM_ID,
      iat: now,
      exp: now + 60 * 60,
      aud: "https://appleid.apple.com",
      sub: process.env.APPLE_SERVICE_ID,
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
    client_id: process.env.APPLE_SERVICE_ID,
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

function decodeAppleIdToken(idToken) {
  const decoded = jwt.decode(idToken);
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid Apple id_token");
  }
  return decoded;
}

/* ---------- GOOGLE (unchanged) ---------- */
router.get("/google", (req, res, next) => {
  if (!passport._strategy("google")) {
    return res.status(501).json({ error: "Google OAuth not configured" });
  }
  const state = req.query.state || "";
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
  passport.authenticate("google", {
    failureRedirect: "/auth/failure",
    session: false,
  }),
  (req, res) => {
    const user = req.user || {};
    const payload = {
      id: Number(user.id),
      email: user.email || null,
      username: user.username || null,
      role: user.role || "USER",
      plan: user.plan || "FREE",
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
    setJwtCookie(res, token);

    let nextUrl = FRONTEND;
    try {
      if (req.query.state) {
        const { next } = JSON.parse(
          Buffer.from(req.query.state, "base64").toString("utf8")
        );
        nextUrl = getSafeNextUrl(next);
      }
    } catch {}

    res.redirect(nextUrl);
  }
);

/* ---------- APPLE (manual) ---------- */
router.get("/apple", (req, res, next) => {
  const statePayload = {
    next: getSafeNextUrl(req.query.next || FRONTEND),
  };

  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64");

  const appleUrl = new URL("https://appleid.apple.com/auth/authorize");
  appleUrl.searchParams.set("client_id", process.env.APPLE_SERVICE_ID);
  appleUrl.searchParams.set("redirect_uri", process.env.APPLE_CALLBACK_URL);
  appleUrl.searchParams.set("response_type", "code");
  appleUrl.searchParams.set("response_mode", "form_post");
  appleUrl.searchParams.set("scope", "name email");
  appleUrl.searchParams.set("state", state);

  return res.redirect(appleUrl.toString());
});

router.post(
  "/apple/callback",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const { code, state, user: rawUser } = req.body || {};

      if (!code) {
        return res.status(400).json({ error: "Missing Apple authorization code" });
      }

      const tokenResponse = await exchangeAppleCodeForTokens(code);
      const claims = decodeAppleIdToken(tokenResponse.id_token);

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
            logContext: {
              channel: "web",
              path: req.originalUrl,
            },
          });
        } catch (err) {
          if (err?.code === "oauth_provider_conflict") {
            return res.status(409).json({
              error: "oauth_provider_conflict",
              message:
                "This Apple account is linked to a different Chatforia account.",
            });
          }
          throw err;
        }

      const payload = {
        id: appUser.id,
        email: appUser.email || null,
        username: appUser.username || null,
        role: appUser.role || "USER",
        plan: appUser.plan || "FREE",
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
      setJwtCookie(res, token);

      let nextUrl = FRONTEND;
      try {
        if (state) {
          const parsed = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
          nextUrl = getSafeNextUrl(parsed?.next);
        }
      } catch {}

      return res.redirect(nextUrl);
    } catch (e) {
      console.error("[APPLE MANUAL CALLBACK ERROR]", {
        message: e?.message,
        response: e?.response?.data,
        stack: e?.stack,
      });
      return res.status(500).json({
        error: "Apple sign-in failed",
        detail: e?.response?.data || e?.message || "Unknown error",
      });
    }
  }
);

router.get("/failure", (_req, res) => res.status(401).send("SSO failed"));

router.get("/debug", (_req, res) => {
  const hasApple = !!(
    process.env.APPLE_SERVICE_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    (process.env.APPLE_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY_PATH) &&
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
      APPLE_SERVICE_ID: !!process.env.APPLE_SERVICE_ID,
      APPLE_TEAM_ID: !!process.env.APPLE_TEAM_ID,
      APPLE_KEY_ID: !!process.env.APPLE_KEY_ID,
      APPLE_PRIVATE_KEY_OR_PATH: !!(
        process.env.APPLE_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY_PATH
      ),
      APPLE_CALLBACK_URL: !!process.env.APPLE_CALLBACK_URL,
    },
  });
});

export default router;