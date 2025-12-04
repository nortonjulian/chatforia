import express from 'express';
import prisma from '../../utils/prismaClient.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

/* -------- POST /:id/reactivate -------- */
router.post('/:id/reactivate', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const phone = await prisma.phoneNumber.findFirst({
      where: {
        id,
        assignedUserId: req.user.id,
      },
    });

    if (!phone) {
      return res.status(404).json({ error: 'Phone not found' });
    }

    await prisma.phoneNumber.update({
      where: { id },
      data: {
        lastOutboundAt: new Date(),
        status: 'ASSIGNED',
        holdUntil: null,
        releaseAfter: null,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to reactivate number:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* -------- GET / (list user phone numbers) -------- */
router.get('/', requireAuth, async (req, res) => {
  try {
    const numbers = await prisma.phoneNumber.findMany({
      where: { assignedUserId: req.user.id },
      select: {
        id: true,
        e164: true,
        status: true,
        releaseAfter: true,
      },
    });

    res.json({ numbers });
  } catch (err) {
    console.error('Failed to fetch user numbers', err);
    res.status(500).json({ error: 'Failed to load numbers' });
  }
});

export default router;
