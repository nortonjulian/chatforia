import express from 'express';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';

import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRegistrationInput } from '../utils/validateUser.js';

// 🔐 secure upload utilities
import { uploadAvatar, uploadDirs } from '../middleware/uploads.js';
import { scanFile } from '../utils/antivirus.js';
import { signDownloadToken } from '../utils/downloadTokens.js';

const router = express.Router();

// Theme control
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
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ error: 'Email already in use' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, email, password: hashedPassword, role: 'USER' },
    });
    const { password: _omit, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.log('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
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
      enableSmartReplies,
      showReadReceipts,
      allowExplicitContent,
      privacyBlurEnabled,
      privacyBlurOnUnfocus,
      privacyHoldToReveal,
      notifyOnCopy,
      preferredLanguage,
      strictE2EE,
      ageBand,
      wantsAgeFilter,
      randomChatAllowedBands,
      theme,
      cycling,
    } = req.body ?? {};

    const data = {};
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

    if (typeof theme === 'string') {
      const t = theme.trim();
      if (!ALL_THEMES.has(t)) return res.status(400).json({ error: 'Invalid theme' });

      if (isPremiumTheme(t)) {
        const me = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { plan: true },
        });
        if (!me?.plan || me.plan === 'FREE') {
          return res.status(402).json({ error: 'Premium theme requires an upgraded plan' });
        }
      }
      data.theme = t;
    }

    if (typeof cycling === 'boolean') data.cycling = cycling;

    const AGE_VALUES = ['TEEN_13_17','ADULT_18_24','ADULT_25_34','ADULT_35_49','ADULT_50_PLUS'];
    if (typeof ageBand === 'string' && AGE_VALUES.includes(ageBand)) {
      data.ageBand = ageBand;
      data.ageAttestedAt = new Date();
    }
    if (typeof wantsAgeFilter === 'boolean') data.wantsAgeFilter = wantsAgeFilter;

    if (Array.isArray(randomChatAllowedBands)) {
      const cleaned = randomChatAllowedBands.map(String).filter((v) => AGE_VALUES.includes(v));
      const meBand = ageBand || (
        await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { ageBand: true },
        })
      )?.ageBand;

      if (meBand === 'TEEN_13_17') {
        data.randomChatAllowedBands = ['TEEN_13_17'];
        data.wantsAgeFilter = true;
      } else {
        data.randomChatAllowedBands = cleaned.filter((v) => v !== 'TEEN_13_17');
      }
    }

    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

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
        theme: true,
        cycling: true,
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
