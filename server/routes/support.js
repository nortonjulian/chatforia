import express from 'express';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

// POST /support/tickets
router.post('/tickets', async (req, res, next) => {
  try {
    const { name, email, message } = req.body || {};

    if (!name || !email || !message) {
      return res.status(400).json({
        error: 'Missing required fields',
      });
    }

    // Save to DB
    const ticket = await prisma.supportTicket.create({
      data: {
        name,
        email,
        message,
        status: 'new',
      },
    });

    // OPTIONAL: later you can also send an email here
    // await sendSupportEmail(ticket);

    return res.status(201).json({
      ok: true,
      ticketId: ticket.id,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
