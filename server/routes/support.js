import express from 'express';
import prisma from '../utils/prismaClient.js';
import { verifyTokenOptional } from '../middleware/auth.js';
import { runSupportAutomation } from '../services/supportAutomationService.js';
import { newRawToken, hashToken } from '../utils/tokens.js';
import { sendMail } from '../utils/sendMail.js';

const router = express.Router();

// POST /support/tickets
router.post('/tickets', verifyTokenOptional, async (req, res, next) => {
  try {
    const { name, email, message, categoryHint } = req.body || {};

    if (!name || !email || !message) {
      return res.status(400).json({
        error: 'Missing required fields',
      });
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        message: String(message).trim(),
        status: 'new',
      },
    });

    const userId = req.user?.id ? Number(req.user.id) : null;

    const automation = await runSupportAutomation({
      userId,
      email,
      message,
      ticketId: ticket.id,
      categoryHint,
      source: 'support_ticket',
    });

    const shouldEscalate =
      automation.autoAction.status === 'escalated' ||
      automation.diagnosis.severity === 'high' ||
      automation.diagnosis.severity === 'urgent';

    if (automation.diagnosis.resolved) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: 'auto_resolved' },
      });
    } else if (shouldEscalate) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: 'escalated' },
      });
    }

    return res.status(201).json({
      ok: true,
      ticketId: ticket.id,
      status: automation.diagnosis.resolved
        ? 'auto_resolved'
        : shouldEscalate
          ? 'escalated'
          : 'queued',
      category: automation.diagnosis.category,
      resolved: automation.diagnosis.resolved,
      severity: automation.diagnosis.severity,
      message: automation.diagnosis.userMessage,
      nextAction: automation.diagnosis.nextAction,
      autoAction: automation.autoAction.action,
    });
  } catch (err) {
    next(err);
  }
});

// POST /support/diagnose
router.post('/diagnose', verifyTokenOptional, async (req, res, next) => {
  try {
    const { email, message, categoryHint } = req.body || {};

    const automation = await runSupportAutomation({
      userId: req.user?.id || null,
      email,
      message,
      categoryHint,
      source: 'support_diagnose',
    });

    return res.json({
      ok: true,
      category: automation.diagnosis.category,
      resolved: automation.diagnosis.resolved,
      severity: automation.diagnosis.severity,
      message: automation.diagnosis.userMessage,
      nextAction: automation.diagnosis.nextAction,
      autoAction: automation.autoAction.action,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/actions', verifyTokenOptional, async (req, res, next) => {
  try {
    const { action, email } = req.body || {};
    const userId = req.user?.id ? Number(req.user.id) : null;

    if (!action) {
      return res.status(400).json({ error: 'action required' });
    }

    if (action === 'offer_resend_verification') {
      const targetEmail = String(email || '').trim().toLowerCase();

      if (!targetEmail) {
        return res.status(400).json({ error: 'email required' });
      }

      const user = await prisma.user.findFirst({
        where: { email: { equals: targetEmail, mode: 'insensitive' } },
        select: {
          id: true,
          email: true,
          username: true,
          emailVerifiedAt: true,
        },
      });

      // Generic success to avoid account enumeration
      if (!user) {
        return res.json({
          ok: true,
          action,
          message: 'If an account exists, a verification email has been sent.',
        });
      }

      if (user.emailVerifiedAt) {
        return res.json({
          ok: true,
          action,
          message: 'Your email is already verified.',
        });
      }

      await prisma.verificationToken.updateMany({
        where: {
          userId: user.id,
          type: 'email',
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });

      const raw = newRawToken();
      const tokenHash = await hashToken(raw);
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          type: 'email',
          tokenHash,
          expiresAt,
        },
      });

      const base =
        process.env.FRONTEND_BASE_URL ||
        process.env.PUBLIC_BASE_URL ||
        process.env.APP_URL ||
        'http://localhost:5173';

      const link = `${base.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(raw)}&uid=${user.id}`;

      await sendMail({
        to: user.email,
        from: process.env.EMAIL_FROM || 'Chatforia <hello@chatforia.com>',
        subject: 'Verify your Chatforia email',
        html: `
          <p>Hello ${user.username || 'there'},</p>
          <p>Click below to verify your Chatforia email:</p>
          <p><a href="${link}">Verify Email</a></p>
        `,
        text: `Verify your Chatforia email:\n${link}`,
      });

      return res.json({
        ok: true,
        action,
        message: 'Verification email sent. Please check your inbox.',
      });
    }

    if (action === 'prompt_restore_purchases_ios') {
      return res.json({
        ok: true,
        action,
        message: 'Open Chatforia on iOS, go to Upgrade, and tap Restore Purchases.',
      });
    }

    if (action === 'prompt_number_selection') {
      return res.json({
        ok: true,
        action,
        redirectTo: '/settings/phone-number',
        message: 'Choose a Chatforia number before sending SMS.',
      });
    }

    if (action === 'route_to_billing_review') {
      return res.json({
        ok: true,
        action,
        message: 'Your billing issue has been flagged for review.',
      });
    }

    return res.status(400).json({
      error: 'Unsupported action',
    });
  } catch (err) {
    next(err);
  }
});

export default router;