import express from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { handleStatusUpdate } from '../lib/telco/messageMonitor.js'; // adjust path if needed

const r = express.Router();

r.post(
  '/status',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const { MessageSid, MessageStatus, To, From, ErrorCode, ErrorMessage } = req.body || {};
    console.log(`[Twilio Status] ${MessageSid}: ${MessageStatus}`, {
      To,
      From,
      ErrorCode,
      ErrorMessage,
    });

    await handleStatusUpdate({ ...req.body }); // safe if exists, or leave commented until stubbed
    res.status(200).send('ok');
  })
);

export default r;
