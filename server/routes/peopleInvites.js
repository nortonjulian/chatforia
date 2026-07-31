import express from 'express';
import crypto from 'crypto';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { sendSms } from '../lib/telco/index.js';
import {
  limiterInvites,
  invitesSmsLimiter,
} from '../middleware/rateLimits.js';

const router = express.Router();

function makeInviteCode(length = 10) {
  return crypto.randomBytes(16).toString("base64url").slice(0, length);
}

function buildInviteUrl(code) {
  const base = (
    process.env.APP_BASE_URL ||
    'https://www.chatforia.com'
  ).replace(/\/+$/, '');

  return `${base}/i/${encodeURIComponent(code)}`;
}

function normalizePhone(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;

  if (hasLeadingPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

const ALLOWED_CHANNELS = new Set([
  'share_link',
  'sms',
  'email',
]);

function normalizeChannel(input) {
  const channel =
    typeof input === 'string'
      ? input.trim().toLowerCase()
      : '';

  if (!channel) return 'share_link';

  return ALLOWED_CHANNELS.has(channel)
    ? channel
    : null;
}

function normalizeEmail(input) {
  if (typeof input !== 'string') return null;

  const email = input.trim().toLowerCase();
  if (!email) return null;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function limitSmsInvitesOnly(req, res, next) {
  const channel = normalizeChannel(req.body?.channel);

  if (channel !== 'sms') {
    return next();
  }

  return invitesSmsLimiter(req, res, next);
}

// POST /people-invites
router.post(
  '/',
  requireAuth,
  limiterInvites,
  limitSmsInvitesOnly,
  async (req, res) => {
    try {
      const inviterUserId = req.user.id;

      const rawTargetPhone =
        typeof req.body?.targetPhone === 'string'
          ? req.body.targetPhone.trim()
          : '';

      const rawTargetEmail =
        typeof req.body?.targetEmail === 'string'
          ? req.body.targetEmail.trim()
          : '';

      const targetPhone =
        normalizePhone(rawTargetPhone);

      const targetEmail =
        normalizeEmail(rawTargetEmail);

      const channel =
        normalizeChannel(req.body?.channel);

      if (!channel) {
        return res.status(400).json({
          error: 'Invalid invite channel.',
        });
      }

      if (rawTargetPhone && !targetPhone) {
        return res.status(400).json({
          error: 'Invalid phone number.',
        });
      }

      if (rawTargetEmail && !targetEmail) {
        return res.status(400).json({
          error: 'Invalid email address.',
        });
      }

      if (channel === 'sms' && !targetPhone) {
        return res.status(400).json({
          error:
            'A phone number is required for SMS invites.',
        });
      }

      if (channel === 'email' && !targetEmail) {
        return res.status(400).json({
          error:
            'An email address is required for email invites.',
        });
      }

      let inviterRecord = null;

      if (channel === 'sms') {
        inviterRecord =
          await prisma.user.findUnique({
            where: {
              id: inviterUserId,
            },
            select: {
              username: true,
              phoneNumber: true,
            },
          });

        const inviterPhone = normalizePhone(
          inviterRecord?.phoneNumber
        );

        if (
          inviterPhone &&
          inviterPhone === targetPhone
        ) {
          return res.status(400).json({
            error:
              'You cannot invite your own phone number.',
          });
        }
      }

      let code;

      for (
        let attempt = 0;
        attempt < 5;
        attempt += 1
      ) {
        const candidate = makeInviteCode();

        const exists =
          await prisma.peopleInvite.findUnique({
            where: {
              code: candidate,
            },
          });

        if (!exists) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        return res.status(500).json({
          error:
            'Failed to generate invite code.',
        });
      }

      const invite =
        await prisma.peopleInvite.create({
          data: {
            code,
            inviterUserId,
            targetPhone,
            targetEmail,
            channel,
          },
        });

      const inviteUrl =
        buildInviteUrl(invite.code);

      if (channel === 'sms') {
        const inviterName =
          inviterRecord?.username?.trim() ||
          req.user?.username?.trim() ||
          'A friend';

        const smsText =
          `${inviterName} invited you to Chatforia — ` +
          `a better way to message globally.\n` +
          `Join here: ${inviteUrl}`;

        const clientRef =
          `people-invite:${invite.id}:${Date.now()}`;

        try {
          const sendResult = await sendSms({
            to: targetPhone,
            text: smsText,
            clientRef,
          });

          if (!sendResult?.messageSid) {
            throw new Error(
              'SMS provider did not return a message SID.'
            );
          }
        } catch (smsError) {
          console.error(
            'people invite SMS send failed',
            {
              inviteId: invite.id,
              error:
                smsError?.message ||
                String(smsError),
            }
          );

          await prisma.peopleInvite
            .update({
              where: {
                id: invite.id,
              },
              data: {
                status: 'revoked',
              },
            })
            .catch(() => {});

          return res.status(502).json({
            error:
              'Failed to send invite SMS.',
          });
        }
      }

      return res.status(201).json({
        ok: true,
        invite,
        url: inviteUrl,
      });
    } catch (error) {
      console.error(
        'people invite create failed',
        error
      );

      return res.status(500).json({
        error: 'Failed to create invite.',
      });
    }
  }
);

// GET /people-invites/:code
router.get("/:code", async (req, res) => {
  try {
    const invite = await prisma.peopleInvite.findUnique({
      where: { code: req.params.code },
      include: {
        inviterUser: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!invite) {
      return res.status(404).json({ error: "Invite not found." });
    }

    const expired = invite.expiresAt && invite.expiresAt < new Date();
    const status = expired && invite.status === "pending" ? "expired" : invite.status;

    return res.json({
      ok: true,
      invite: {
        code: invite.code,
        status,
        targetPhone: invite.targetPhone,
        targetEmail: invite.targetEmail,
        inviterUser: invite.inviterUser,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    console.error("people invite preview failed", error);
    return res.status(500).json({ error: "Failed to load invite." });
  }
});

// POST /people-invites/:code/redeem
router.post("/:code/redeem", requireAuth, async (req, res) => {
  try {
    const currentUserId = req.user.id;

    const invite = await prisma.peopleInvite.findUnique({
      where: { code: req.params.code },
    });

    if (!invite) {
      return res.status(404).json({ error: "Invite not found." });
    }

    if (invite.inviterUserId === currentUserId) {
      return res.status(400).json({ error: "You cannot redeem your own invite." });
    }

    if (invite.status === "accepted") {
      return res.status(409).json({ error: "Invite already accepted." });
    }

    if (invite.status === "revoked") {
      return res.status(410).json({ error: "Invite revoked." });
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return res.status(410).json({ error: "Invite expired." });
    }

    const updated = await prisma.peopleInvite.update({
      where: { id: invite.id },
      data: {
        status: "accepted",
        acceptedByUserId: currentUserId,
      },
    });

    return res.json({
      ok: true,
      invite: updated,
    });
  } catch (error) {
    console.error("people invite redeem failed", error);
    return res.status(500).json({ error: "Failed to redeem invite." });
  }
});

export default router;