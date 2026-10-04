import express from 'express';
import authRouter from '../auth.js';

const router = express.Router();
// Keep any legacy mount on the same single-use verification implementation.
router.post('/verify-phone-code', (req, res, next) => authRouter(req, res, next));
export default router;
