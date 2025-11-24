import express from 'express';
import prisma from '../utils/prismaClient.js';
import { updatePortStatus } from '../services/portingService.js';

const router = express.Router();

// Twilio will POST to this URL when port status changes
router.post('/', async (req, res, next) => {
  try {
    const payload = req.body;

    // Example – you’ll adjust these based on Twilio’s actual webhook shape
    const externalPortId = payload.portInSid || payload.portOrderSid;
    const status         = payload.status; // e.g. 'pending', 'submitted', 'in-progress', 'completed', 'failed'
    const reason         = payload.statusReason || payload.errorMessage || null;

    if (!externalPortId) {
      console.warn('Porting webhook missing externalPortId:', payload);
      return res.status(400).json({ error: 'Missing externalPortId' });
    }

    const portRequest = await prisma.portRequest.findFirst({
      where: { externalPortId },
    });

    if (!portRequest) {
      console.warn('No PortRequest found for externalPortId', externalPortId);
      return res.json({ ok: true });
    }

    let mappedStatus = 'IN_PROGRESS';
    if (status === 'completed') mappedStatus = 'COMPLETED';
    else if (status === 'failed') mappedStatus = 'FAILED';
    else if (status === 'pending' || status === 'submitted') mappedStatus = 'SUBMITTED';

    const updated = await updatePortStatus(portRequest.id, {
      status: mappedStatus,
      statusReason: reason,
      scheduledAt: payload.scheduledDate ? new Date(payload.scheduledDate) : undefined,
      completedAt: status === 'completed' ? new Date() : undefined,
    });

    // If completed: attach phoneNumber to user’s PhoneNumber model and update routing.
    if (mappedStatus === 'COMPLETED') {
      // Example: mark this as user’s primary Chatforia number
      await prisma.phoneNumber.upsert({
        where: { userId: updated.userId },
        create: {
          userId: updated.userId,
          phoneNumber: updated.phoneNumber,
          isPrimary: true,
          source: 'PORTED',
        },
        update: {
          phoneNumber: updated.phoneNumber,
          isPrimary: true,
          source: 'PORTED',
        },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
