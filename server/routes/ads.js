import express from 'express';
import prisma from '../utils/prismaClient.js';
import { sendMail } from '../utils/sendMail.js';

const router = express.Router();

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
      const subject = `New advertising inquiry from ${name}`;

      const htmlBody = `
        <h2>New advertising inquiry</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Company:</strong> ${company || '—'}</p>
        <p><strong>Budget:</strong> ${budget || '—'}</p>
        <p><strong>Message:</strong></p>
        <p>${String(message).replace(/\n/g, '<br>')}</p>
        <hr>
        <p><strong>Internal ID:</strong> ${inquiry.id}</p>
      `;

      await sendMail({
        to: 'ads@chatforia.com',
        subject,
        html: htmlBody,
        replyTo: email,
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