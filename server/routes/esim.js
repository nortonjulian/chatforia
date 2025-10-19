import express from 'express';
import {
  reserveProfile,
  activateProfile,
  suspendProfile,
  resumeProfile,
} from '../controllers/esimController.js';

const router = express.Router();
router.post('/profiles', /* auth */ reserveProfile);
router.post('/activate', /* auth */ activateProfile);
router.post('/suspend',  /* auth */ suspendProfile);
router.post('/resume',   /* auth */ resumeProfile);
export default router;
