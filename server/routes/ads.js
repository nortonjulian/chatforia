import express from 'express';
import prisma from '../utils/prismaClient.js';
import nodemailer from 'nodemailer';

const router = express.Router();

/**
 * Create a reusable Nodemailer transporter from env.
 * Configure these env vars in your server environment:
 *  - SMTP_HOST
 *  - SMTP_PORT
 *  - SMTP_USER
 *  - SMTP_PASS
 *  - SMTP_FROM (optional, defaults to ads@chatforia.com)
 */
function createTransporter() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    // You can log a warning instead of throwing if you want the route
    // to succeed even when email is misconfigured.
    throw new Error('SMTP configuration is missing');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // true for 465, false for others
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return { transporter, from: SMTP_FROM || 'ads@chatforia.com' };
}

// Basic email format validator
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /ads/inquiries
router.post('/inquiries', async (req, res, next) => {
  try {
    const { name, email, company, budget, message } = req.body || {};

    if (!name || !email || !message) {
      return res.status(400).json({
        error: 'Missing required fields: name, email, and message are required.',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'Invalid email address.',
      });
    }

    // Save to database
    const inquiry = await prisma.adInquiry.create({
      data: {
        name,
        email,
        company: company || null,
        budget: budget || null,
        message,
        status: 'new',
      },
    });

    // Try to send notification email
    try {
      const { transporter, from } = createTransporter();

      const subject = `New advertising inquiry from ${name}`;
      const textBody =
        `New advertising inquiry:\n\n` +
        `Name: ${name}\n` +
        `Email: ${email}\n` +
        `Company: ${company || '—'}\n` +
        `Budget: ${budget || '—'}\n\n` +
        `${message}\n\n` +
        `Internal ID: ${inquiry.id}`;

      await transporter.sendMail({
        from,
        to: 'ads@chatforia.com',
        replyTo: email,
        subject,
        text: textBody,
      });
    } catch (emailErr) {
      // Log but don't fail the request – the inquiry is saved in DB
      console.error('Failed to send ad inquiry email:', emailErr);
    }

    return res.status(201).json({
      ok: true,
      id: inquiry.id,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
