import express from 'express';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';

import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRegistrationInput } from '../utils/validateUser.js';

// 🔐 secure upload utilities (Option B)
import { uploadAvatar, uploadDirs } from '../middleware/uploads.js';
import { scanFile } from '../utils/antivirus.js';
import { signDownloadToken } from '../utils/downloadTokens.js';

const router = express.Router();

/* ---------------------- THEME ALLOW-LIST (server) ---------------------- */
// Keep this server-side so clients can’t spoof new keys.
const FREE_THEMES = ['dawn', 'midnight'];
const PREMIUM_THEMES = ['amoled', 'aurora', 'neon', 'sunset', 'solarized', 'velvet'];
const ALL_THEMES = new Set([...FREE_THEMES, ...PREMIUM_THEMES]);

function isPremiumTheme(t) {
  return PREMIUM_THEMES.includes(t);
}

/* ---------------------- PUBLIC: create user ---------------------- */
router.post('/', async (req, res) => {
  const { username, email, password } = req.body;

  const validationError = validateRegistrationInput(username, email, password);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role: 'USER',
      },
    });

    const { password: _omit, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.log('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/* ---------------------- USER SEARCH ---------------------- */
router.get('/search', requireAuth, async (req, res) => {
  try {
    const qRaw = String(req.query.query || '').trim();
    if (!qRaw) return res.json([]);

    const isAdmin = req.user?.role === 'ADMIN';
    const qDigits = qRaw.replace(/\D+/g, '');

    const OR = [
      { username: { contains: qRaw, mode: 'insensitive' } },
      { email: { contains: qRaw, mode: 'insensitive' } },
    ];

    if (qDigits.length >= 4) OR.push({ phoneNumber: { contains: qDigits } });
    if (/^\+?\d{4,}$/.test(qRaw)) OR.push({ phoneNumber: { contains: qRaw } });

    const users = await prisma.user.findMany({
      where: { OR, NOT: { id: req.user.id } },
      select: isAdmin
        ? {
            id: true,
            username: true,
            email: true,
            phoneNumber: true,
            preferredLanguage: true,
          }
        : {
            id: true,
            username: true,
            phoneNumber: true,
            preferredLanguage: true,
          },
      take: 10,
    });

    res.json(users);
  } catch (error) {
    console.error('Search failed:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/* ---------------------- UPDATE (self or admin) ---------------------- */
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user;

  if (Number(id) !== currentUser.id && currentUser.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const {
    // language/translation
    preferredLanguage,
    showOriginalWithTranslation,   // backend field name
    showOriginalAndTranslation,    // frontend alias

    // messaging prefs
    allowExplicitContent,
    enableReadReceipts,            // maps to showReadReceipts
    autoDeleteSeconds,
    privacyBlurEnabled,
    privacyBlurOnUnfocus,
    privacyHoldToReveal,
    notifyOnCopy,

    // theme
    theme,
    cycling,
  } = req.body ?? {};

  const data = {};

  if (typeof preferredLanguage === 'string' && preferredLanguage.trim()) {
    data.preferredLanguage = preferredLanguage.trim().slice(0, 16);
  }

  if (typeof allowExplicitContent === 'boolean') data.allowExplicitContent = allowExplicitContent;

  // accept either key from UI, persist as showOriginalWithTranslation
  if (typeof showOriginalWithTranslation === 'boolean') {
    data.showOriginalWithTranslation = showOriginalWithTranslation;
  }
  if (typeof showOriginalAndTranslation === 'boolean') {
    data.showOriginalWithTranslation = showOriginalAndTranslation;
  }

  if (typeof enableReadReceipts === 'boolean') data.showReadReceipts = enableReadReceipts;

  if (Number.isInteger(autoDeleteSeconds)) data.autoDeleteSeconds = autoDeleteSeconds;

  if (typeof privacyBlurEnabled === 'boolean') data.privacyBlurEnabled = privacyBlurEnabled;
  if (typeof privacyBlurOnUnfocus === 'boolean') data.privacyBlurOnUnfocus = privacyBlurOnUnfocus;
  if (typeof privacyHoldToReveal === 'boolean') data.privacyHoldToReveal = privacyHoldToReveal;
  if (typeof notifyOnCopy === 'boolean') data.notifyOnCopy = notifyOnCopy;

  // Theme (validate + plan gate against target user's plan)
  if (typeof theme === 'string') {
    const t = theme.trim();
    if (!ALL_THEMES.has(t)) {
      return res.status(400).json({ error: 'Invalid theme' });
    }
    if (isPremiumTheme(t)) {
      const target = await prisma.user.findUnique({
        where: { id: Number(id) },
        select: { plan: true },
      });
      const isPremium = target?.plan && target.plan !== 'FREE';
      if (!isPremium) {
        return res.status(402).json({ error: 'Premium theme requires an upgraded plan' });
      }
    }
    data.theme = t;
  }

  if (typeof cycling === 'boolean') data.cycling = cycling;

  try {
    const updatedUser = await prisma.user.update({
      where: { id: Number(id) },
      data,
    });
    res.json(updatedUser);
  } catch (error) {
    console.log('Error updating user', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/* ---------------------- AVATAR UPLOAD (Option B) ---------------------- */
router.post(
  '/me/avatar',
  requireAuth,
  uploadAvatar.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      // Determine absolute path:
      // - if disk storage: req.file.path exists
      // - if memory storage: write buffer to avatars dir
      let absPath = req.file.path;
      if (!absPath && req.file.buffer) {
        const safeBase = (req.file.originalname || 'avatar')
          .replace(/[^\w.\-]+/g, '_')
          .slice(0, 80);
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}_${safeBase}`;
        absPath = path.join(uploadDirs.AVATARS_DIR, filename);
        await fs.promises.writeFile(absPath, req.file.buffer);
      }

      if (!absPath) {
        return res.status(500).json({ error: 'Upload failed: no file path/buffer' });
      }

      // Antivirus scan (path-based)
      const av = await scanFile(absPath);
      if (!av.ok) {
        await fs.promises.unlink(absPath).catch(() => {});
        return res.status(400).json({ error: 'File failed security scan' });
      }

      // Store only the private relative filename; signed URL used for serving
      const rel = path.basename(absPath);

      await prisma.user.update({
        where: { id: req.user.id },
        data: { avatarUrl: rel },
        select: { id: true },
      });

      // Short-lived signed URL (prefix with avatars/)
      const token = signDownloadToken({
        path: path.join('avatars', rel),
        ownerId: req.user.id,
        ttlSec: 300,
      });

      res.json({ avatarUrl: `/files?token=${encodeURIComponent(token)}` });
    } catch (error) {
      console.log('Avatar upload failed', error);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

/* ---------------------- PUBLIC KEY UPLOAD ---------------------- */
router.post('/keys', requireAuth, async (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) return res.status(400).json({ error: 'Missing publicKey' });

  try {
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { publicKey },
      select: { id: true, publicKey: true },
    });
    res.json(updated);
  } catch (e) {
    console.error('Key upload failed', e);
    res.status(500).json({ error: 'Failed to upload key' });
  }
});

/* ---------------------- EMOJI TAG ---------------------- */
router.patch('/emoji', requireAuth, async (req, res) => {
  const { emoji } = req.body;
  const userId = req.user.id;

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { emojiTag: emoji },
    });

    res.json({ emojiTag: updated.emojiTag });
  } catch (err) {
    console.error('Emoji update failed', err);
    res.status(500).json({ error: 'Failed to update emoji' });
  }
});

/* ---------------------- PROFILE (me) ---------------------- */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: Number(req.user.id) },
      select: {
        id: true,
        username: true,
        email: true,
        phoneNumber: true,
        preferredLanguage: true,
        avatarUrl: true, // private filename; use POST /me/avatar response for signed URL
        emojiTag: true,
        role: true,
        plan: true,

        // theme prefs
        theme: true,
        cycling: true,

        // prefs & toggles used by UI
        enableSmartReplies: true,
        showReadReceipts: true,
        allowExplicitContent: true,
        privacyBlurEnabled: true,
        privacyBlurOnUnfocus: true,
        privacyHoldToReveal: true,
        notifyOnCopy: true,
        strictE2EE: true,

        // ✅ accessibility prefs
        a11yUiFont: true,
        a11yVisualAlerts: true,
        a11yVibrate: true,
        a11yFlashOnCall: true,
        a11yLiveCaptions: true,
        a11yVoiceNoteSTT: true,
        a11yCaptionFont: true,
        a11yCaptionBg: true,
        a11yStoreTranscripts: true,
        a11yTranscriptRetentionDays: true,
        a11yCaptionPosition: true,
        a11yCaptionMaxLines: true,

        // age prefs for Random Chat
        ageBand: true,
        ageAttestedAt: true,
        wantsAgeFilter: true,
        randomChatAllowedBands: true,
      },
    });
    res.json(me);
  } catch (e) {
    console.error('GET /users/me failed', e);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

/* ---------------------- UPDATE (me) ---------------------- */
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const {
      // Existing prefs
      enableSmartReplies,
      showReadReceipts,
      allowExplicitContent,
      privacyBlurEnabled,
      privacyBlurOnUnfocus,
      privacyHoldToReveal,
      notifyOnCopy,
      preferredLanguage,

      // NEW: E2EE strict toggle
      strictE2EE,

      // NEW: age prefs
      ageBand,
      wantsAgeFilter,
      randomChatAllowedBands,

      // theme prefs
      theme,
      cycling,
    } = req.body ?? {};

    const data = {};

    // existing toggles...
    if (typeof enableSmartReplies === 'boolean') data.enableSmartReplies = enableSmartReplies;
    if (typeof showReadReceipts === 'boolean') data.showReadReceipts = showReadReceipts;
    if (typeof allowExplicitContent === 'boolean') data.allowExplicitContent = allowExplicitContent;
    if (typeof privacyBlurEnabled === 'boolean') data.privacyBlurEnabled = privacyBlurEnabled;
    if (typeof privacyBlurOnUnfocus === 'boolean') data.privacyBlurOnUnfocus = privacyBlurOnUnfocus;
    if (typeof privacyHoldToReveal === 'boolean') data.privacyHoldToReveal = privacyHoldToReveal;
    if (typeof notifyOnCopy === 'boolean') data.notifyOnCopy = notifyOnCopy;
    if (typeof preferredLanguage === 'string' && preferredLanguage.trim()) {
      data.preferredLanguage = preferredLanguage.trim().slice(0, 16);
    }
    if (typeof strictE2EE === 'boolean') data.strictE2EE = strictE2EE;

    // theme prefs (validate + plan gate for current user)
    if (typeof theme === 'string') {
      const t = theme.trim();
      if (!ALL_THEMES.has(t)) {
        return res.status(400).json({ error: 'Invalid theme' });
      }
      if (isPremiumTheme(t)) {
        const me = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { plan: true },
        });
        const isPremium = me?.plan && me.plan !== 'FREE';
        if (!isPremium) {
          return res.status(402).json({ error: 'Premium theme requires an upgraded plan' });
        }
      }
      data.theme = t;
    }

    if (typeof cycling === 'boolean') {
      data.cycling = cycling;
    }

    // age prefs (safety rules)
    const AGE_VALUES = ['TEEN_13_17','ADULT_18_24','ADULT_25_34','ADULT_35_49','ADULT_50_PLUS'];

    if (typeof ageBand === 'string' && AGE_VALUES.includes(ageBand)) {
      data.ageBand = ageBand;
      data.ageAttestedAt = new Date(); // remember attestation time
    }

    if (typeof wantsAgeFilter === 'boolean') {
      data.wantsAgeFilter = wantsAgeFilter;
    }

    if (Array.isArray(randomChatAllowedBands)) {
      const cleaned = randomChatAllowedBands
        .map(String)
        .filter((v) => AGE_VALUES.includes(v));

      const meBand = ageBand || (
        await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { ageBand: true },
        })
      )?.ageBand;

      if (meBand === 'TEEN_13_17') {
        data.randomChatAllowedBands = ['TEEN_13_17']; // force teen-only
        data.wantsAgeFilter = true; // ensure on
      } else {
        data.randomChatAllowedBands = cleaned.filter((v) => v !== 'TEEN_13_17'); // adults: never include teens
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updated = await prisma.user.update({
      where: { id: Number(req.user.id) },
      data,
      select: {
        id: true,
        enableSmartReplies: true,
        showReadReceipts: true,
        allowExplicitContent: true,
        privacyBlurEnabled: true,
        privacyBlurOnUnfocus: true,
        privacyHoldToReveal: true,
        notifyOnCopy: true,
        preferredLanguage: true,
        strictE2EE: true,

        // theme prefs
        theme: true,
        cycling: true,

        // return the age prefs too
        ageBand: true,
        ageAttestedAt: true,
        wantsAgeFilter: true,
        randomChatAllowedBands: true,
      },
    });

    res.json(updated);
  } catch (e) {
    console.error('PATCH /users/me failed', e);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
