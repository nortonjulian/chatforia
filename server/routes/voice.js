import express from 'express';
import twilio from 'twilio';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { startAliasCall } from '../services/voiceBridge.js';
import logger from '../utils/logger.js';

const r = express.Router();

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

// POST /voice/token
// Gives the browser a Twilio Voice SDK token.
r.post(
  '/token',
  requireAuth,
  express.json(),
  asyncHandler(async (req, res) => {
    const {
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      TWILIO_TWIML_APP_SID,
    } = process.env;

    if (
      !TWILIO_ACCOUNT_SID ||
      !TWILIO_API_KEY_SID ||
      !TWILIO_API_KEY_SECRET ||
      !TWILIO_TWIML_APP_SID
    ) {
      return res.status(500).json({
        error: 'Twilio browser voice is not configured',
      });
    }

    const identity = `user:${req.user.id}`;
    const ttlSeconds = 3600;

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      {
        identity,
        ttl: ttlSeconds,
      }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    token.addGrant(voiceGrant);

    res.json({
      token: token.toJwt(),
      identity,
      ttlSeconds,
    });
  })
);

// POST /voice/call { to }
r.post(
  '/call',
  requireAuth,
  express.json(),
  asyncHandler(async (req, res) => {
    const { to } = req.body || {};

    logger?.info?.(
      { userId: req.user.id, to },
      'Placing alias call from /voice/call'
    );

    const out = await startAliasCall({ userId: req.user.id, to });
    res.status(202).json(out);
  })
);

export default r;