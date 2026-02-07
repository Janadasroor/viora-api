import intractionsController from "../controllers/InteractionsController.js";
import { Router } from "express";
import { validate } from '../middleware/validation.js';
import { interactionSchemas } from '../validators/schemas/index.js';

const router = Router();

router.delete('/comments/:commentId/like', validate(interactionSchemas.unlikeCommentSchema), intractionsController.unlikeComment);
router.delete('/stories/:storyId/like', validate(interactionSchemas.unlikeStorySchema), intractionsController.unlikeStory);
router.delete('/posts/:postId/like', validate(interactionSchemas.unlikePostSchema), intractionsController.unlikePost);
router.post('/stories/:storyId/like', validate(interactionSchemas.likeStorySchema), intractionsController.likeStory);
router.delete('/reels/:reelId/like', validate(interactionSchemas.unlikeReelSchema), intractionsController.unlikeReel);
router.post('/comments/:commentId/like', validate(interactionSchemas.likeCommentSchema), intractionsController.likeComment);
router.post('/posts/:postId/like', validate(interactionSchemas.likePostSchema), intractionsController.likePost);
router.post('/reels/:reelId/like', validate(interactionSchemas.likeReelSchema), intractionsController.likeReel);
router.post('/posts/:postId/share', validate(interactionSchemas.sharePostSchema), intractionsController.sharePost);
router.post('/posts/:postId/interested', intractionsController.recordInterested);
router.post('/posts/:postId/not-interested', intractionsController.recordNotInterested);
router.post('/view', intractionsController.recordView);

export default router;