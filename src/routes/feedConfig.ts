import { Router } from 'express';
import { updateConfig, getAll } from '../controllers/FeedConfigController.js';
const router = Router();
router.post("/",updateConfig);
router.get("/",getAll);
export default router;
