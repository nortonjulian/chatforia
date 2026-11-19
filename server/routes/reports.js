import express from 'express';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

import { requireAuth } from '../middleware/auth.js';
import { createOpenReport } from '../services/openReportTransaction.js';

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

// A profile can be reported even when there is no message to attach. Keep it
// in the same moderation queue as message reports, without exposing private
// account details or allowing duplicate open reports for the same account.
router.post('/users/:userId', requireAuth, async (req, res) => {
  try {
    const reporterId = Number(req.user?.id);
    const reportedUserId = Number(req.params.userId);
    if (!Number.isSafeInteger(reporterId) || reporterId <= 0) {
      return res.status(401).json({ error: 'Invalid authenticated user' });
    }
    if (!Number.isSafeInteger(reportedUserId) || reportedUserId <= 0 || reportedUserId === reporterId) {
      return res.status(400).json({ error: 'Invalid reported user' });
    }

    const target = await prisma.user.findUnique({
      where: { id: reportedUserId }, select: { id: true },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const existing = await prisma.report.findFirst({
      where: { reporterId, reportedUserId, messageId: null, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ error: 'You already reported this user' });

    const details = typeof req.body?.details === 'string'
      ? req.body.details.trim().slice(0, 2000) : '';
    const result = await createOpenReport(prisma, { reporterId, reportedUserId }, (tx) => tx.report.create({
      data: {
        reporterId,
        reportedUserId,
        decryptedContent: '[User profile report]',
        reason: normalizeReason(req.body?.reason),
        details: details || null,
        evidence: { source: 'user_profile' },
        status: 'OPEN',
      },
      select: { id: true },
    }));
    if (result.duplicate) return res.status(409).json({ error: 'You already reported this user' });
    const report = result.report;
    res.locals.audit = {
      action: 'USER_CREATE_REPORT', targetUserId: reportedUserId,
      notes: normalizeReason(req.body?.reason),
    };
    return res.status(201).json({ success: true, reportId: report.id });
  } catch (e) {
    console.error('POST /reports/users/:userId failed:', e);
    return res.status(500).json({ error: 'Failed to submit report' });
  }
});

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
      reportedContent,
      contextCount = 10,
      blockAfterReport = false,
    } = req.body || {};

    const parsedMessageId = Number(messageId);
    const parsedContextCount = Math.max(0, Math.min(Number(contextCount) || 0, 20));
    const normalizedReason = normalizeReason(reason);

    const trimmedDetails = typeof details === 'string' ? details.trim() : '';
    const safeDetails = trimmedDetails ? trimmedDetails.slice(0, 2000) : null;
    const submittedContent = typeof reportedContent === 'string'
      ? reportedContent.trim().slice(0, 4000)
      : '';

    if (!Number.isInteger(parsedMessageId)) {
      return res.status(400).json({ error: 'Valid messageId is required' });
    }

    // Scope the lookup itself to the reporter's room membership. A report
    // must never reveal another conversation's message or context in its
    // response, including when the caller guesses a valid message ID.
    const message = await prisma.message.findFirst({
      where: {
        id: parsedMessageId,
        chatRoom: { participants: { some: { userId: reporterId } } },
      },
      select: {
        id: true,
        senderId: true,
        chatRoomId: true,
        rawContent: true,
        translatedContent: true,
        createdAt: true,
        attachments: {
          where: { deletedAt: null },
          select: { id: true, kind: true, url: true, thumbUrl: true, mimeType: true },
        },
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

    // Avoid fetching context on an ordinary retry; the locked check inside
    // createOpenReport remains authoritative for concurrent requests.
    const existingOpenReport = await prisma.report.findFirst({
      where: { messageId: parsedMessageId, reporterId, status: 'OPEN' },
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

    if (message.attachments?.length) {
      evidence = { ...(evidence || {}), reportedAttachments: message.attachments };
    }
    if (submittedContent) {
      // The reporter elected to share what their device displayed. It is
      // user-submitted evidence, not independently verified server plaintext.
      evidence = { ...(evidence || {}), contentSource: 'reporter_submission' };
    }

    const decryptedContent =
      submittedContent ||
      message.rawContent ||
      message.translatedContent ||
      '[Encrypted or unavailable content]';

    const result = await createOpenReport(prisma, { reporterId, messageId: parsedMessageId }, async (tx) => {
      const created = await tx.report.create({
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
            select: { id: true, username: true },
          },
          reportedUser: {
            select: { id: true, username: true, isBanned: true },
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
      if (blockAfterReport) {
        await tx.userBlock.upsert({
          where: { blockerId_blockedId: { blockerId: reporterId, blockedId: message.senderId } },
          update: {},
          create: { blockerId: reporterId, blockedId: message.senderId },
        });
      }
      return created;
    });
    if (result.duplicate) {
      return res.status(409).json({ error: 'You already reported this message' });
    }
    const report = result.report;

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
