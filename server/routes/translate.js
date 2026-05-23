import express from "express";
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

export default router;