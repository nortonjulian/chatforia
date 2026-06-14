import express from "express";
import Boom from "@hapi/boom";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../utils/prismaClient.js";
import { translate } from "../utils/translationService.js";

const router = express.Router();

router.post("/test", async (req, res) => {
  try {
    const { text, targetLang = "ES", sourceLang = null } = req.body;
    const translatedText = await translate(text, targetLang, sourceLang);

    res.json({ original: text, translated: translatedText });
  } catch (err) {
    console.error("DeepL test error:", err);
    res.status(500).json({ error: "Translation failed" });
  }
});

router.post("/message-preview", requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    const chatRoomId = Number(req.body?.chatRoomId);
    const text = String(req.body?.text || "").trim();

    const targetLangs = Array.isArray(req.body?.targetLangs)
      ? req.body.targetLangs
          .map((x) => String(x || "").trim().toUpperCase())
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
      const translated = await translate(text, lang, null);

      if (translated) {
        translations[lang.toLowerCase()] = translated;
      }
    }

    return res.json({ translations });
  } catch (err) {
    next(err.isBoom ? err : Boom.badImplementation(err.message));
  }
});

export default router;