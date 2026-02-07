import express from 'express';
const router = express.Router();
// Auth & User Routes
import authRouter from './auth.js';
import usersRouter from './users.js';

// Content Routes
import postsRouter from './posts.js';
import reelsRouter from './reels.js';
import storiesRouter from './stories.js';
import feedRouter from './feed.js';

// Interaction Routes
import commentsRouter from './comments.js';
import intractionsRouter from './interactions.js';

// Media Routes
import mediaRouter from './media.js';
import chatMediaRouter from './chatMediaUploader.js';

// Communication Routes
import messengerRouter from './messenger.js';
import notificationsRouter from './notifications.js';

// Utility Routes
import searchRouter from './search.js';
import themeRouter from './theme.js';
import feedConfigRouter from './feedConfig.js';
import reportsRouter from './reports.js';
import analyticsRouter from './analytics.js';
import { authenticateToken } from '@/utils/authMiddleWare.js';
import { validate } from '@/middleware/validation.js';
import { interactionSchemas } from '@/validators/schemas/index.js';
import intractionsController from '@/controllers/InteractionsController.js';


// ============================================================================
// API Routes
// ============================================================================
// Auth Routes (No authentication required)
router.use("/auth", authRouter);
// Admin Routes
router.use("/admin/feed-config/update", feedConfigRouter);
router.use("/admin/feed-config/get", feedConfigRouter);

// Media Upload Routes
router.use("/chat", chatMediaRouter);

router.use("/media", authenticateToken, mediaRouter);

router.use("/users", authenticateToken, usersRouter);

// Content Routes (Authenticated + Email Verified)
router.use("/feed", authenticateToken, feedRouter);
router.use("/reels", authenticateToken, reelsRouter);
router.use("/stories", authenticateToken, storiesRouter);
router.use("/interactions", authenticateToken, intractionsRouter);

router.use("/posts", authenticateToken, postsRouter);

// Interaction Routes (Authenticated + Email Verified)
router.use("/comments", authenticateToken, commentsRouter);

// Communication Routes
router.use("/messenger", authenticateToken, messengerRouter);
router.use("/notifications", authenticateToken, notificationsRouter);

// Utility Routes (Authenticated + Email Verified)
router.use("/search", authenticateToken, searchRouter);
router.use("/reports", authenticateToken, reportsRouter);
router.use("/analytics", authenticateToken, analyticsRouter);
router.use("/themes", themeRouter);

export default router;