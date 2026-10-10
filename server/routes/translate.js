import express from "express";
import Boom from "@hapi/boom";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../utils/prismaClient.js";
import { translateText } from "../services/translation/googleTranslate.js";
import {
  countTranslationCharacters,
  withTranslationAllowance,
} from '../services/translation/translationUsageService.js';

const router = express.Router();

router.post("/test", requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    const text = String(req.body?.text || "").trim();
    const targetLang = String(req.body?.targetLang || "es")
      .trim()
      .toLowerCase();

    if (!text) {
      throw Boom.badRequest("text required");
    }

    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });

    const out = await withTranslationAllowance({
      userId,
      plan: me?.plan || 'FREE',
      amount: countTranslationCharacters(text),
      operation: () => translateText(text, targetLang),
      shouldBillResult: (result) =>
        result?.provider === 'google',
    });

    return res.json({
      original: text,
      translated: out?.translated || null,
    });
  } catch (err) {
    console.error("Google Translate test error:", {
      message: err?.message,
      code: err?.code,
    });

    if (err?.isBoom || err?.code === 'PLAN_ALLOWANCE_EXCEEDED') {
      return next(err);
    }

    return next(Boom.badImplementation(err.message));
  }
});

router.post("/message-preview", requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    const chatRoomId = Number(req.body?.chatRoomId);
    const text = String(req.body?.text || "").trim();

    const targetLangs = Array.isArray(req.body?.targetLangs)
      ? req.body.targetLangs
         .map((x) => String(x || "").trim().toLowerCase())
          .filter(Boolean)
      : [];

    if (!Number.isFinite(chatRoomId)) {
      throw Boom.badRequest("Invalid chatRoomId");
    }

    if (!text) {
      throw Boom.badRequest("text required");
    }

    const membership = await prisma.participant.findFirst({
      where: { chatRoomId, userId },
      select: { userId: true },
    });

    if (!membership) {
      throw Boom.forbidden("Not a participant");
    }

    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });

    const translations = {};
    const amount = countTranslationCharacters(text);

    for (const lang of [...new Set(targetLangs)]) {
      try {
        const out = await withTranslationAllowance({
          userId,
          plan: me?.plan || 'FREE',
          amount,
          operation: () =>
            translateText(text, lang.toLowerCase()),
          shouldBillResult: (result) =>
            result?.provider === 'google',
        });
        const translated = out?.translated || null;

        if (translated) {
          translations[lang.toLowerCase()] = translated;
        }
      } catch (err) {
        console.error("[message-preview] failed", {
          lang,
          error: err?.message || err,
        });

        if (err?.code === 'PLAN_ALLOWANCE_EXCEEDED') {
          throw err;
        }
      }
    }

    return res.json({ translations });
  } catch (err) {
    if (err?.isBoom || err?.code === 'PLAN_ALLOWANCE_EXCEEDED') {
      return next(err);
    }

    return next(Boom.badImplementation(err.message));
  }
});

export default router;