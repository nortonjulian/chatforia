import express from "express";
import prisma from "../utils/prismaClient.js";
import { sendVerificationSMS } from "../services/sms.js";

const router = express.Router();

router.post("/request-phone-verification", async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber)
    return res.status(400).json({ error: "Phone number required" });

  // generate code
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.phoneVerificationRequest.create({
    data: {
      phoneNumber,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      consentedAt: new Date(),
      verificationCode: code,
      expiresAt
    }
  });

  await sendVerificationSMS(phoneNumber, code);

  res.json({ success: true });
});

export default router;
