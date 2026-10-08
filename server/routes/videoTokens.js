import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import twilio from 'twilio';
import prisma from '../utils/prismaClient.js';
import { getUsageAvailability } from '../services/callUsageService.js';

const router = express.Router();

router.post('/video/token', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const { room, roomName } = req.body || {};
    const resolvedRoom = String(room || roomName || '').trim();

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        error: 'unauthorized',
      });
    }

    if (!resolvedRoom) {
      return res.status(400).json({
        error: 'room is required',
      });
    }

    const roomMatch = resolvedRoom.match(/^call_(\d+)$/);

    if (!roomMatch) {
      return res.status(400).json({
        error: 'invalid_video_room',
      });
    }

    const callId = Number(roomMatch[1]);

    const call = await prisma.call.findFirst({
      where: {
        id: callId,
        OR: [
          { callerId: userId },
          { calleeId: userId },
          {
            participants: {
              some: {
                userId,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        callerId: true,
        calleeId: true,
        externalPhone: true,
        status: true,
      },
    });

    if (!call) {
      return res.status(403).json({
        error: 'video_room_forbidden',
      });
    }

    if (call.externalPhone) {
      return res.status(400).json({
        error: 'video_room_not_hosted',
      });
    }

    const hostedAvailability = await getUsageAvailability({
      userId: call.callerId,
      meter: 'hostedParticipantSeconds',
    });

    if (
      hostedAvailability.remaining != null &&
      hostedAvailability.remaining <= 0
    ) {
      return res.status(429).json({
        error: 'Hosted call allowance exhausted',
        code: 'PLAN_ALLOWANCE_EXCEEDED',
        detail: 'hostedParticipantSeconds',
        limit: hostedAvailability.limit,
        used: hostedAvailability.used,
        remaining: hostedAvailability.remaining,
      });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({
        error: 'missing_twilio_video_env',
      });
    }

    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;
    const identity = `user-${userId}`;

    const token = new AccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      {
        identity,
        ttl: 60 * 60,
      }
    );

    token.addGrant(
      new VideoGrant({
        room: resolvedRoom,
      })
    );

    return res.json({
      token: token.toJwt(),
      room: resolvedRoom,
      identity,
      remainingHostedSeconds:
        hostedAvailability.remaining == null
          ? null
          : hostedAvailability.remaining,
    });
  } catch (e) {
    console.error('[video][token] error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack,
    });

    return res.status(500).json({
      error: 'failed_to_issue_token',
    });
  }
});

export default router;
