import express from 'express';
import { orderSim } from '../controllers/simsController.js';
const router = express.Router();
router.post('/order', /* auth */ orderSim);
export default router;
