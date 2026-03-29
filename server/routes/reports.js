import express from 'express';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

import { requireAuth } from '../middleware/auth.js';

const prisma = new PrismaClient();
const router = express.Router();

function normalizeReason(reason) {
  const value = String(reason || '').trim().toLowerCase();

  const map = {
    harassment: 'HARASSMENT',
    threats: 'VIOLENCE',
    hate: 'HATE',
    sexual_content: 'NUDITY',
    spam_scam: 'SCAM',
    impersonation: 'IMPERSONATION',
    other: 'OTHER',
  };

  return map[value] || 'OTHER';
}

router.post('/', requireAuth, async (req, res) => {
  try {
    const reporterId = Number(req.user?.id);
    if (!Number.isInteger(reporterId)) {
      return res.status(401).json({ error: 'Invalid authenticated user' });
    }

    const {
      messageId,
      reason,
      details,
      contextCount = 10,
      blockAfterReport = false,
    } = req.body || {};

    const parsedMessageId = Number(messageId);
    const parsedContextCount = Math.max(0, Math.min(Number(contextCount) || 0, 20));
    const normalizedReason = normalizeReason(reason);

    const trimmedDetails = typeof details === 'string' ? details.trim() : '';
    const safeDetails = trimmedDetails ? trimmedDetails.slice(0, 2000) : null;

    if (!Number.isInteger(parsedMessageId)) {
      return res.status(400).json({ error: 'Valid messageId is required' });
    }

    const message = await prisma.message.findUnique({
      where: { id: parsedMessageId },
      select: {
        id: true,
        senderId: true,
        chatRoomId: true,
        rawContent: true,
        translatedContent: true,
        createdAt: true,
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId === reporterId) {
      return res.status(400).json({ error: 'You cannot report your own message' });
    }

    const existingOpenReport = await prisma.report.findFirst({
      where: {
        messageId: parsedMessageId,
        reporterId,
        status: 'OPEN',
      },
      select: { id: true },
    });

    if (existingOpenReport) {
      return res.status(409).json({ error: 'You already reported this message' });
    }

    let evidence = null;

    if (message.chatRoomId && parsedContextCount > 0) {
      const contextMessages = await prisma.message.findMany({
        where: {
          chatRoomId: message.chatRoomId,
          createdAt: {
            lte: message.createdAt,
          },
        },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: parsedContextCount + 1,
        select: {
          id: true,
          senderId: true,
          rawContent: true,
          translatedContent: true,
          createdAt: true,
          sender: {
            select: {
              username: true,
            },
          },
        },
      });

      evidence = {
        contextCount: parsedContextCount,
        contextMessages: contextMessages.reverse().map((m) => ({
          id: m.id,
          senderId: m.senderId,
          username: m.sender?.username || null,
          text: m.rawContent || m.translatedContent || null,
          createdAt: m.createdAt,
        })),
      };
    }

    const decryptedContent =
      message.rawContent ||
      message.translatedContent ||
      '[Encrypted or unavailable content]';

    const report = await prisma.report.create({
      data: {
        messageId: message.id,
        reporterId,
        reportedUserId: message.senderId,
        chatRoomId: message.chatRoomId,
        decryptedContent,
        reason: normalizedReason,
        details: safeDetails,
        evidence,
        blockApplied: Boolean(blockAfterReport),
        status: 'OPEN',
      },
      include: {
        reporter: {
          select: { id: true, username: true, email: true },
        },
        reportedUser: {
          select: { id: true, username: true, email: true, isBanned: true },
        },
        message: {
          select: {
            id: true,
            rawContent: true,
            translatedContent: true,
            chatRoomId: true,
            createdAt: true,
            sender: {
              select: { id: true, username: true, isBanned: true },
            },
          },
        },
      },
    });

    res.locals.audit = {
      action: 'USER_CREATE_REPORT',
      targetMessageId: message.id,
      targetUserId: message.senderId,
      notes: normalizedReason,
    };

    return res.status(201).json({
      success: true,
      report,
    });
  } catch (e) {
    console.error('POST /reports failed:', e);
    return res.status(500).json({ error: 'Failed to submit report' });
  }
});

export default router;