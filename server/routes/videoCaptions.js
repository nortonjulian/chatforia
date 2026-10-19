import express from 'express';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { hasPremiumAccess } from '../utils/planAccess.js';
import { createVideoCaptionProvider } from '../services/videoCaptionProvider.js';
import { createVideoCaptionSessions } from '../services/videoCaptionSessions.js';

const router = express.Router();
const sessions = createVideoCaptionSessions({ db: prisma, provider: createVideoCaptionProvider(), hasPremiumAccess });
router.post('/:callId/captions/:sessionId', requireAuth, sessions.start);
router.post('/:callId/captions/:sessionId/lease', requireAuth, sessions.lease);
router.delete('/:callId/captions/:sessionId', requireAuth, sessions.stop);
export default router;
