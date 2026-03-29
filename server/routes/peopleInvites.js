import express from 'express';
import crypto from 'crypto';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function makeInviteCode(length = 10) {
  return crypto.randomBytes(16).toString("base64url").slice(0, length);
}

function buildInviteUrl(code) {
  return `${process.env.APP_BASE_URL || "www.chatforia.com"}/i/${code}`;
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

// POST /people-invites
router.post("/", requireAuth, async (req, res) => {
  try {
    const inviterUserId = req.user.id;
    const targetPhone = normalizePhone(req.body?.targetPhone);
    const targetEmail = typeof req.body?.targetEmail === "string"
      ? req.body.targetEmail.trim().toLowerCase()
      : null;
    const channel = typeof req.body?.channel === "string" && req.body.channel.trim()
      ? req.body.channel.trim()
      : "share_link";

    let code;
    for (let i = 0; i < 5; i++) {
      const candidate = makeInviteCode();
      const exists = await prisma.peopleInvite.findUnique({ where: { code: candidate } });
      if (!exists) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      return res.status(500).json({ error: "Failed to generate invite code." });
    }

    const invite = await prisma.peopleInvite.create({
      data: {
        code,
        inviterUserId,
        targetPhone,
        targetEmail,
        channel,
      },
    });

    return res.status(201).json({
      ok: true,
      invite,
      url: buildInviteUrl(invite.code),
    });
  } catch (error) {
    console.error("people invite create failed", error);
    return res.status(500).json({ error: "Failed to create invite." });
  }
});

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