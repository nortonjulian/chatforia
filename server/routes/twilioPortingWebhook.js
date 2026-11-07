import express from 'express';
import prisma from '../utils/prismaClient.js';
import { updatePortStatus } from '../services/portingService.js';
import { toE164 } from '../utils/phone.js';

const router = express.Router();

// Twilio will POST to this URL when port status changes
router.post('/', async (req, res, next) => {
  try {
    const payload = req.body;

    const externalPortId = payload.port_in_request_sid ||
      payload.portInSid || payload.portOrderSid;
    const status = payload.status;

    if (typeof externalPortId !== 'string' || !externalPortId.trim()) {
      return res.status(400).json({ error: 'Missing externalPortId' });
    }

    // The schema can represent a port in progress, but it has no rejected or
    // canceled state. A request-level completion can also include numbers that
    // were canceled. Do not assign a number or claim completion from it.
    if (!['waiting_for_signature', 'submitted', 'pending', 'in_progress'].includes(status)) {
      return res.status(422).json({ error: 'Unsupported port status' });
    }

    const portRequest = await prisma.portRequest.findFirst({
      where: { externalPortId },
    });

    if (!portRequest) {
      return res.json({ ok: true });
    }

    if (portRequest.status === 'PORTED_IN') {
      return res.json({ ok: true });
    }

    if (payload.port_in_phone_number_sid &&
        (typeof payload.phone_number !== 'string' ||
          !toE164(payload.phone_number) ||
          toE164(payload.phone_number) !==
            toE164(portRequest.phoneNumber, portRequest.country || 'US'))) {
      return res.status(409).json({ error: 'Port phone number mismatch' });
    }

    await updatePortStatus(portRequest.id, {
      status: 'PORT_IN_PENDING',
      statusReason: null,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
