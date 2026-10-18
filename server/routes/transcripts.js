import express from 'express';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { hasPremiumAccess } from '../utils/planAccess.js';
import { a11yConfig } from '../config/a11yConfig.js';
import { transcribeVoiceNote } from '../services/stt/voiceNote.js';
import { createVoiceNoteHandlers } from '../services/voiceNoteTranscription.js';

const router = express.Router();
const handlers = createVoiceNoteHandlers({ db: prisma, transcribe: transcribeVoiceNote, hasPremiumAccess, config: a11yConfig });
router.post('/media/:messageId/transcribe', requireAuth, handlers.post);
router.get('/transcripts/:messageId', requireAuth, handlers.get);
export default router;
