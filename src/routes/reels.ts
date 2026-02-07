import { Router } from 'express';
import reelController from '../controllers/ReelController.js';
import { validate } from '../middleware/validation.js';
import { reelSchemas } from '../validators/schemas/index.js';

const router = Router();

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

// Get reels by user - Public
router.get('/user/:userId',
  validate(reelSchemas.getReelsByUserSchema),
  reelController.getReelsByUser
);

// ============================================
// AUTHENTICATED ROUTES
// ============================================
// Note: Add 'authenticate' middleware to all routes below in production

// Get personalized reel feed - Requires auth
// IMPORTANT: This must come BEFORE /:reelId route to avoid "feed" being matched as a reelId
router.get('/feed',
  validate(reelSchemas.getReelFeedSchema),
  reelController.getReelFeed
);

// Get single reel by ID - Public or Authenticated
router.get('/:reelId',
  // Add validation if needed, e.g., validate(reelSchemas.getReelByIdSchema),
  reelController.getReelById
);

// Create reel - Requires auth + validation
router.post('/',
  validate(reelSchemas.createReelSchema),
  reelController.createReel
);

// Modify/Update reel caption - Requires auth + validation
router.put('/:reelId',
  validate(reelSchemas.modifyReelSchema),
  reelController.modifyReel
);

// Delete reel - Requires auth
router.delete('/:reelId',
  validate(reelSchemas.deleteReelSchema),
  reelController.deleteReel
);

// ============================================
// REEL INTERACTIONS
// ============================================

// Increment view count - Can be public or authenticated
router.post('/:reelId/view',  
  validate(reelSchemas.incrementReelViewSchema),
  reelController.incrementReelView
);

// ============================================
// ADMIN/SYSTEM ROUTES
// ============================================

// Process reel views (batch processing) - Should be admin only or system cron job
router.post('/process-views',
  validate(reelSchemas.processReelViewsSchema),
  reelController.processReelViews
);

export default router;