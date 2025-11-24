import express from 'express';
import {
  createPortRequestForUser,
  getUserPortRequests,
  getUserPortRequestById,
} from '../services/portingService.js';

const router = express.Router();

// All routes assume `req.user` is populated by your auth middleware

// POST /api/porting
router.post('/', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const portRequest = await createPortRequestForUser(user, req.body);
    res.status(201).json(portRequest);
  } catch (err) {
    next(err);
  }
});

// GET /api/porting
router.get('/', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const requests = await getUserPortRequests(user.id);
    res.json(requests);
  } catch (err) {
    next(err);
  }
});

// GET /api/porting/:id
router.get('/:id', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const request = await getUserPortRequestById(user.id, id);
    if (!request) return res.status(404).json({ error: 'Not found' });

    res.json(request);
  } catch (err) {
    next(err);
  }
});

export default router;
