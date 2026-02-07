import express from 'express';
import reportController from '../controllers/ReportController.js';
import { authenticateToken } from '../utils/authMiddleWare.js';

const router = express.Router();

router.post('/', authenticateToken, reportController.createReport);

export default router;
