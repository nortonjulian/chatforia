import express from 'express';
import { getConnectivityOptions } from '../controllers/connectivityController.js';
const router = express.Router();
router.get('/options', /* auth? */ getConnectivityOptions);
export default router;
