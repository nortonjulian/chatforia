import express from "express";
import Boom from "@hapi/boom";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../utils/prismaClient.js";
import { translateText } from "../services/translation/googleTranslate.js";

const router = express.Router();

router.post("/test", async (req, res) => {
  try {
    const { text, targetLang = "es" } = req.body;

    const out = await translateText(text, String(targetLang).toLowerCase());
    const translatedText = out?.translated || null;

    res.json({ original: text, translated: translatedText });
  } catch (err) {
   console.error("Google Translate test error:", {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      stack: err?.stack,
    });

    res.status(500).json({
      error: err?.message || "Translation failed",
      code: err?.code || null,
      details: err?.details || null,
    });
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

    const translations = {};

    for (const lang of [...new Set(targetLangs)]) {
      try {
        const out = await translateText(text, lang.toLowerCase());
        const translated = out?.translated || null;

        if (translated) {
          translations[lang.toLowerCase()] = translated;
        }
      } catch (err) {
        console.error("[message-preview] failed", {
          lang,
          error: err?.message || err,
        });
      }
    }

    return res.json({ translations });
  } catch (err) {
    next(err.isBoom ? err : Boom.badImplementation(err.message));
  }
});

export default router;