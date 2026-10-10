import express from 'express';
import rateLimit from 'express-rate-limit';
import authRouter from './auth.js';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';

import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRegistrationInput } from '../utils/validateUser.js';

import { premiumConfig } from '../config/premiumConfig.js'; // or wherever it lives

// 🔐 secure upload utilities
import { uploadAvatar, uploadDirs } from '../middleware/uploads.js';
import { scanFile } from '../utils/antivirus.js';

import { serializeUser } from '../utils/serializeUser.js';
import { canForwardVoicemailEmail, isValidVoicemailEmail } from '../utils/voicemailForwarding.js';

const router = express.Router();

// Theme control
const FREE_THEMES = ['dawn', 'midnight'];
const PREMIUM_THEMES = ['amoled', 'aurora', 'neon', 'sunset', 'solarized', 'velvet'];
const ALL_THEMES = new Set([...FREE_THEMES, ...PREMIUM_THEMES]);

function isPremiumTheme(t) {
  return PREMIUM_THEMES.includes(t);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
  const clean = String(value || '').trim().toLowerCase();
  return clean || null;
}

/* ---------------------- PUBLIC: create user ---------------------- */
// --- inside routes/users (replace the existing POST / handler) ---
// Legacy creation endpoint uses the same validation, verification and transaction.
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });
router.post('/', registrationLimiter, (req, res, next) => {
  const originalUrl = req.url;
  const originalJson = res.json.bind(res);
  res.json = payload => {
    res.json = originalJson;
    req.url = originalUrl;
    // Preserve the legacy top-level public user response on success.
    if (res.statusCode === 201 && payload?.user) {
      return originalJson({ ...payload.user, requiresEmailVerification: true });
    }
    return originalJson(payload);
  };
  req.url = '/register';
  return authRouter(req, res, error => {
    req.url = originalUrl;
    res.json = originalJson;
    next(error);
  });
});

/* ---------------------- GET /users/lookup ---------------------- */
/* Resolve username -> userId (for adding contacts) */
router.get('/lookup', requireAuth, async (req, res) => {
  const username = (req.query.username || '').toString().trim();

  if (!username) {
    return res.status(400).json({ error: 'Missing username' });
  }

  const me = Number(req.user.id);

  const user = await prisma.user.findFirst({
    where: {
      username: { equals: username, mode: 'insensitive' },
      id: { not: me },
      isBanned: false,
      isSystem: false,
      isTestAccount: false,
      deletedAt: null,
      OR: [
        { discoverability: 'EVERYONE' },
        {
          discoverability: 'CONTACTS_ONLY',
          contactsSaved: {
            some: {
              ownerId: me,
            },
          },
        },
      ],
    },
    select: { id: true, username: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // optional: block adding yourself
  if (Number(user.id) === Number(req.user.id)) {
    return res.status(400).json({ error: 'You cannot add yourself as a contact' });
  }

  return res.json({ userId: user.id, username: user.username });
});

/* ---------------------- GET /users/search ---------------------- */
router.get('/search', requireAuth, async (req, res) => {
  try {
    const me = Number(req.user.id);
    const query = (req.query.query || '').toString().trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 20);

    if (query.length < 2) {
      return res.json([]);
    }

    const users = await prisma.user.findMany({
      where: {
        id: { not: me },

        username: {
          contains: query,
          mode: 'insensitive',
        },

        isBanned: false,
        isSystem: false,
        isTestAccount: false,
        deletedAt: null,

        OR: [
          {
            discoverability: 'EVERYONE',
          },
          {
            discoverability: 'CONTACTS_ONLY',
            contactsSaved: {
              some: {
                ownerId: me,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
      orderBy: {
        username: 'asc',
      },
      take: limit,
    });

    return res.json(users);
  } catch (error) {
    console.error('GET /users/search failed:', error);
    return res.status(500).json({ error: 'Failed to search users' });
  }
});

/* ---------------------- PATCH /users/me ---------------------- */
router.patch('/me', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      console.warn('⚠️ PATCH /users/me — req.user missing');
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const {
      username, 
      enableSmartReplies,
      autoTranslate,
      discoverability,
      showOriginalWithTranslation,
      showReadReceipts,
      allowExplicitContent,
      privacyBlurEnabled,
      privacyBlurOnUnfocus,
      privacyHoldToReveal,
      notifyOnCopy,
      preferredLanguage,
      uiLanguage, 
      strictE2EE,
      ageBand,
      wantsAgeFilter,
      randomChatAllowedBands,
      theme,
      cycling,
      messageTone,
      soundVolume,
      ringtone,
      riaRemember,
      voicemailEnabled,
      voicemailAutoDeleteDays,
      voicemailForwardEmail,
      voicemailEmailForwardingEnabled,
      voicemailGreetingText,
    } = req.body ?? {};

    // Build whitelist of updatable fields
    const data = {};
    // ✅ Username update (for OAuth onboarding)
    if (typeof username === 'string' && username.trim()) {
      const clean = username.trim();

      const usernameNorm = normalizeUsername(clean);

      // Basic validation
      if (clean.length < 3 || clean.length > 20) {
        return res.status(400).json({ error: 'Username must be 3–20 characters' });
      }

      if (!/^[a-zA-Z0-9_]+$/.test(clean)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
      }

      // Check uniqueness (case-insensitive)
      const existing = await prisma.user.findFirst({
        where: {
          usernameNorm,
          NOT: { id: Number(req.user.id) },
        },
        select: { id: true },
      });

      if (existing) {
        return res.status(409).json({ error: 'Username already taken' });
      }

      data.username = clean;

      data.usernameNorm = usernameNorm;
    }

        if (typeof discoverability === 'string') {
          const value = discoverability.trim().toUpperCase();

          if (!['EVERYONE', 'CONTACTS_ONLY', 'NO_ONE'].includes(value)) {
            return res.status(400).json({ error: 'Invalid discoverability' });
          }

          data.discoverability = value;
        }

    if (typeof enableSmartReplies === 'boolean') {
      data.enableSmartReplies = enableSmartReplies;
    }

    if (typeof autoTranslate === 'boolean') {
      data.autoTranslate = autoTranslate;
    }

    if (typeof showOriginalWithTranslation === 'boolean') {
      data.showOriginalWithTranslation = showOriginalWithTranslation;
    }

    if (typeof showReadReceipts === 'boolean') {
      data.showReadReceipts = showReadReceipts;
    }

    if (typeof allowExplicitContent === 'boolean') {
      data.allowExplicitContent = allowExplicitContent;
    }

    if (typeof privacyBlurEnabled === 'boolean') {
      data.privacyBlurEnabled = privacyBlurEnabled;
    }

    if (typeof privacyBlurOnUnfocus === 'boolean') {
      data.privacyBlurOnUnfocus = privacyBlurOnUnfocus;
    }

    if (typeof privacyHoldToReveal === 'boolean') {
      data.privacyHoldToReveal = privacyHoldToReveal;
    }

    if (typeof notifyOnCopy === 'boolean') {
      data.notifyOnCopy = notifyOnCopy;
    }

    if (typeof preferredLanguage === 'string' && preferredLanguage.trim()) {
      data.preferredLanguage = preferredLanguage.trim().slice(0, 16);
    }

    if (typeof uiLanguage === 'string' && uiLanguage.trim()) {
      data.uiLanguage = uiLanguage.trim().slice(0, 16);
    }

    if (typeof strictE2EE === 'boolean') {
      data.strictE2EE = strictE2EE;
    }

    // 👇 NEW: Ria memory flag
    if (typeof riaRemember === 'boolean') {
      data.riaRemember = riaRemember;
    }

    // 👇 NEW: Voicemail toggles
    if (typeof voicemailEnabled === 'boolean') {
      data.voicemailEnabled = voicemailEnabled;
    }

    if (voicemailAutoDeleteDays !== undefined) {
      // Allow null/empty string to clear it (keep forever)
      if (voicemailAutoDeleteDays === null || voicemailAutoDeleteDays === '') {
        data.voicemailAutoDeleteDays = null;
      } else {
        const days = Number(voicemailAutoDeleteDays);
        if (Number.isFinite(days) && days > 0 && days < 3650) {
          data.voicemailAutoDeleteDays = days;
        } else {
          return res.status(400).json({ error: 'Invalid voicemailAutoDeleteDays' });
        }
      }
    }

    if (typeof voicemailForwardEmail === 'string') {
      const emailTrimmed = voicemailForwardEmail.trim();
      // Legacy clients may clear the address, but cannot implicitly opt in.
      if (!emailTrimmed) {
        data.voicemailForwardEmail = null;
        data.voicemailEmailForwardingEnabled = false;
      } else if (emailTrimmed.length > 255) {
        return res.status(400).json({ error: 'voicemailForwardEmail too long' });
      } else {
        // Light sanity check; you can make this stricter if you want.
        if (!isValidVoicemailEmail(emailTrimmed)) {
          return res.status(400).json({ error: 'Invalid voicemailForwardEmail' });
        }
        data.voicemailForwardEmail = emailTrimmed;
      }
    }

    if (voicemailEmailForwardingEnabled !== undefined) {
      if (typeof voicemailEmailForwardingEnabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid voicemailEmailForwardingEnabled' });
      }
      if (voicemailEmailForwardingEnabled) {
        // Read entitlement from the database, not a stale token or client plan.
        const me = await prisma.user.findUnique({
          where: { id: Number(req.user.id) },
          select: { plan: true, voicemailForwardEmail: true },
        });
        if (!canForwardVoicemailEmail(me)) {
          return res.status(402).json({
            error: 'paid_plan_required',
            message: 'Voicemail email forwarding requires Plus or Premium.',
          });
        }
        const email = data.voicemailForwardEmail !== undefined
          ? data.voicemailForwardEmail : me?.voicemailForwardEmail;
        if (!isValidVoicemailEmail(email?.trim())) {
          return res.status(400).json({ error: 'A valid forwarding email is required' });
        }
      }
      data.voicemailEmailForwardingEnabled = voicemailEmailForwardingEnabled;
    }

    if (typeof voicemailGreetingText === 'string') {
      const txt = voicemailGreetingText.trim();
      data.voicemailGreetingText = txt || null;
    }

    // Theme (with premium enforcement)
    if (typeof theme === 'string') {
      const t = theme.trim();
      if (!ALL_THEMES.has(t)) {
        return res.status(400).json({ error: 'Invalid theme' });
      }

      // If it's a premium theme, verify the user's plan
      if (isPremiumTheme(t)) {
        const me = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { plan: true },
        });

        if (
          String(me?.plan || 'FREE')
            .trim()
            .toUpperCase() !== 'PREMIUM'
        ) {
          return res.status(402).json({
            error: 'Premium theme requires an upgraded plan',
          });
        }
      }

      data.theme = t;
    }

    if (typeof cycling === 'boolean') {
      data.cycling = cycling;
    }

    // Message tone
    if (typeof messageTone === 'string') {
      const val = messageTone.trim();

      const all = new Set([
        ...premiumConfig.tones.freeMessageTones,
        ...premiumConfig.tones.premiumMessageTones,
      ]);

      if (!all.has(val)) {
        return res.status(400).json({ error: 'Invalid messageTone' });
      }

      if (premiumConfig.tones.premiumMessageTones.includes(val)) {
        const me = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { plan: true },
        });

        if (
          String(me?.plan || 'FREE')
            .trim()
            .toUpperCase() !== 'PREMIUM'
        ) {
          return res.status(402).json({
            error: 'Premium message tone requires upgrade',
          });
        }
      }

      data.messageTone = val;
    }

    // Ringtone
    if (typeof ringtone === 'string') {
      const val = ringtone.trim();

      const all = new Set([
        ...premiumConfig.tones.freeRingtones,
        ...premiumConfig.tones.premiumRingtones,
      ]);

      if (!all.has(val)) {
        return res.status(400).json({ error: 'Invalid ringtone' });
      }

      if (premiumConfig.tones.premiumRingtones.includes(val)) {
        const me = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { plan: true },
        });

        if (
          String(me?.plan || 'FREE')
            .trim()
            .toUpperCase() !== 'PREMIUM'
        ) {
          return res.status(402).json({
            error: 'Premium ringtone requires upgrade',
          });
        }
      }

      data.ringtone = val;
    }

    if (soundVolume !== undefined) {
      const volume = Number(soundVolume);

      if (Number.isFinite(volume) && volume >= 0 && volume <= 100) {
        data.soundVolume = Math.round(volume);
      } else {
        return res.status(400).json({ error: 'Invalid soundVolume' });
      }
    }

    // Age stuff
    const AGE_VALUES = [
      'TEEN_13_17',
      'ADULT_18_24',
      'ADULT_25_34',
      'ADULT_35_49',
      'ADULT_50_PLUS',
    ];

    if (typeof ageBand === 'string' && AGE_VALUES.includes(ageBand)) {
      data.ageBand = ageBand;
      data.ageAttestedAt = new Date();
    }

    if (typeof wantsAgeFilter === 'boolean') {
      data.wantsAgeFilter = wantsAgeFilter;
    }

    if (Array.isArray(randomChatAllowedBands)) {
      // sanitize incoming bands
      const cleaned = randomChatAllowedBands
        .map(String)
        .filter((v) => AGE_VALUES.includes(v));

      // get their current or updated band so we can enforce teen isolation
      const meBand =
        ageBand ||
        (
          await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { ageBand: true },
          })
        )?.ageBand;

      if (meBand === 'TEEN_13_17') {
        // teens can only match other teens; also force filter on
        data.randomChatAllowedBands = ['TEEN_13_17'];
        data.wantsAgeFilter = true;
      } else {
        // adults cannot include TEEN_13_17
        data.randomChatAllowedBands = cleaned.filter((v) => v !== 'TEEN_13_17');
      }
    }

    // Nothing to update?
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    let updated;
    try {
      updated = await prisma.user.update({
        where: { id: Number(req.user.id) },
        data,
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          plan: true,
          publicKey: true,
          avatarUrl: true,
          discoverability: true,
          preferredLanguage: true,
          uiLanguage: true,
          enableSmartReplies: true,
          autoTranslate: true,
          showOriginalWithTranslation: true,
          showReadReceipts: true,
          allowExplicitContent: true,
          privacyBlurEnabled: true,
          privacyBlurOnUnfocus: true,
          privacyHoldToReveal: true,
          notifyOnCopy: true,
          strictE2EE: true,
          theme: true,
          cycling: true,
          messageTone: true,
          ringtone: true,
          soundVolume: true,
          ageBand: true,
          ageAttestedAt: true,
          wantsAgeFilter: true,
          randomChatAllowedBands: true,
          riaRemember: true,
          voicemailEnabled: true,
          voicemailAutoDeleteDays: true,
          voicemailForwardEmail: true,
          voicemailEmailForwardingEnabled: true,
          voicemailGreetingText: true,
          voicemailGreetingUrl: true,
        },
      });
    } catch (err) {
      console.error('💥 prisma.user.update failed in PATCH /users/me', {
        userId: req.user.id,
        dataTryingToWrite: data,
        err,
      });
      return res
        .status(500)
        .json({ error: 'Failed to update profile (db write failed)' });
    }


    return res.json(serializeUser(updated));
  } catch (e) {
    console.error('PATCH /users/me failed (outer catch)', e);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

/* ---------------------- DELETE /users/me ---------------------- */
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user.id);

    await prisma.user.delete({
      where: { id: userId },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('💥 DELETE /users/me failed', err);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

/* ---------------------- POST /users/me/avatar ---------------------- */
router.post(
  '/me/avatar',
  requireAuth,
  (req, res, next) => {
    uploadAvatar.single('avatar')(req, res, (err) => {
      if (err) {
        console.error('🚨 Multer avatar upload error:', err);
        return res.status(400).json({ error: err.message || 'Upload rejected' });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.user) {
        console.warn('⚠️ POST /users/me/avatar — req.user missing');
        return res.status(403).json({ error: 'Not authenticated' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const originalExt = path.extname(req.file.originalname || '').toLowerCase();
      const ext = originalExt || '.jpg';

      const baseName = path.basename(req.file.originalname || 'avatar', originalExt);
      const safeBase = baseName
        .replace(/[^\w.\-]+/g, '_')
        .slice(0, 80);

      const filename = `${req.user.id}_${Date.now()}_${safeBase}${ext}`;

      let finalFilename = filename;

      if (uploadDirs.TARGET === 'memory') {
        const fullPath = path.join(uploadDirs.AVATARS_DIR, filename);
        await fs.promises.writeFile(fullPath, req.file.buffer);
      } else {
        finalFilename = req.file.filename || filename;
      }

      try {
        const fullForScan = path.join(uploadDirs.AVATARS_DIR, finalFilename);
        await scanFile(fullForScan);
      } catch (e) {
        console.error('⚠️ Avatar antivirus scan skipped/failed', e);
        // TEMP: do not block avatar uploads while antivirus is unavailable
      }

      const avatarUrl = `/uploads/avatars/${finalFilename}`;

      const updated = await prisma.user.update({
        where: { id: Number(req.user.id) },
        data: { avatarUrl },
        select: { avatarUrl: true },
      });

      return res.json({ avatarUrl: updated.avatarUrl });
    } catch (err) {
      console.error('💥 POST /users/me/avatar failed', err);
      return res.status(500).json({ error: 'Failed to upload avatar' });
    }
  }
);

router.delete('/me/avatar', requireAuth, async (req, res) => {
  try {
    const updated = await prisma.user.update({
      where: { id: Number(req.user.id) },
      data: { avatarUrl: null },
      select: { avatarUrl: true },
    });

    return res.json({ avatarUrl: updated.avatarUrl });
  } catch (err) {
    console.error('💥 DELETE /users/me/avatar failed', err);
    return res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

export default router;